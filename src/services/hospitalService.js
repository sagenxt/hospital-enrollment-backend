const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');


const hospitalRepository = require('../repositories/hospitalRepository');

function extractHospitalData(body) {
  // body can be either flat (all fields at top-level), nested metadata object,
  // or multipart fields using names like 'metadata[field]'. We'll normalize all.
  const mainDetails = {
    name: body && body.name,
    city: body && body.city,
    address: body && body.address,
    telephone: body && body.telephone,
    mobile: body && body.mobile,
    fax: body && body.fax,
    email: body && body.email,
    superintendent_name: body && body.superintendent_name,
    superintendent_contact: body && body.superintendent_contact,
    superintendent_email: body && body.superintendent_email,
    superintendent_phone: body && body.superintendent_phone
  };

  // Start with an empty metadata object and merge candidates into it
  const metadata = {};

  if (!body) return { mainDetails, metadata };

  // 1) If body.metadata exists and is an object, merge it
  if (typeof body.metadata === 'object' && body.metadata !== null) {
    Object.assign(metadata, body.metadata);
  }

  // 2) If body.metadata exists as a JSON string, try to parse and merge
  if (typeof body.metadata === 'string') {
    try { Object.assign(metadata, JSON.parse(body.metadata)); } catch (e) { /* ignore */ }
  }

  // 3) Merge any top-level fields that are not part of mainDetails into metadata
  for (const [k, v] of Object.entries(body)) {
    if (k === 'metadata') continue;
    if (Object.prototype.hasOwnProperty.call(mainDetails, k)) continue;
    // handle form field names like 'metadata[fieldName]' produced by some clients
    const metadataFieldMatch = k.match(/^metadata\[(.+)\]$/);
    if (metadataFieldMatch) {
      const innerKey = metadataFieldMatch[1];
      metadata[innerKey] = v;
      continue;
    }
    // Otherwise copy to metadata if not empty
    metadata[k] = v;
  }

  // 4) For any metadata entries that are JSON strings (arrays/objects), parse them
  for (const key of Object.keys(metadata)) {
    const val = metadata[key];
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try { metadata[key] = JSON.parse(trimmed); continue; } catch (e) { /* ignore */ }
      }
      // Normalize boolean-like strings
      if (trimmed.toLowerCase() === 'true' || trimmed.toLowerCase() === 'yes' || trimmed === '1') metadata[key] = 'YES';
      else if (trimmed.toLowerCase() === 'false' || trimmed.toLowerCase() === 'no' || trimmed === '0') metadata[key] = 'NO';
    }
  }

  // Remove mainDetails keys from metadata if still present
  for (const key of Object.keys(mainDetails)) delete metadata[key];

  // Normalize commonly used metadata fields so tables get predictable values
  function normString(v, def = 'N/A') {
    if (v === undefined || v === null) return def;
    if (typeof v === 'string' && v.trim() === '') return def;
    return v;
  }

  // specialties: ensure array (may come as JSON string or as array)
  if (metadata.specialties) {
    if (typeof metadata.specialties === 'string') {
      try { metadata.specialties = JSON.parse(metadata.specialties); } catch (e) { /* keep as string */ }
    }
    if (!Array.isArray(metadata.specialties)) {
      // if it's a comma-separated list, split it
      if (typeof metadata.specialties === 'string') {
        metadata.specialties = metadata.specialties.split(',').map(s => ({ name: s.trim(), head: 'N/A' }));
      } else {
        metadata.specialties = [];
      }
    }
  } else {
    metadata.specialties = [];
  }

  // Tie-ups and binary flags
  metadata.empaneled_cghs = normString(metadata.empaneled_cghs, 'N/A');
  metadata.recognized_aarogyasri = normString(metadata.recognized_aarogyasri, 'N/A');
  metadata.tpi_tieup = normString(metadata.tpi_tieup, 'N/A');

  // Biomedical
  metadata.biomedical_waste = normString(metadata.biomedical_waste, 'N/A');
  metadata.pcb_license = normString(metadata.pcb_license, 'N/A');

  // Bank defaults
  metadata.bank_name = normString(metadata.bank_name, 'N/A');
  metadata.bank_branch = normString(metadata.bank_branch, 'N/A');
  metadata.account_number = normString(metadata.account_number, 'N/A');
  metadata.ifsc_code = normString(metadata.ifsc_code, 'N/A');
  metadata.micr_no = normString(metadata.micr_no, 'N/A');

  return { mainDetails, metadata };
}

// export for testing
exports._extractHospitalData = extractHospitalData;

function generateAnnexurePDF(mainDetails, metadata) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 40,
        bufferPages: true
      });

      const buffers = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      // Helper function to draw a compact table (page-break aware)
      function drawTable(x, y, width, headers, rows) {
        const colWidth = width / headers.length;
        const rowHeight = 18;
        let currentY = y;
        const pageTop = doc.page.margins.top || 40;
        const pageBottom = doc.page.height - (doc.page.margins.bottom || 40);
        const footerHeight = 30; // Reserve space for footer

        // internal helper to draw header at given y
        function drawHeader(atY) {
          doc.fillColor('#e0e0e0');
          doc.rect(x, atY, width, rowHeight).fill();
          doc.fillColor('black');
          headers.forEach((header, i) => {
            doc.font('Helvetica-Bold')
               .fontSize(8)
               .text(header, x + (i * colWidth) + 3, atY + 3, {
                 width: colWidth - 6,
                 align: 'left'
               });
          });
        }

        // Track the top Y for the current page segment so we can draw borders for that segment
        let segmentStartY = currentY;
        // Ensure there's room for header + at least one data row; if not, start a new page.
        if (currentY + rowHeight + rowHeight > pageBottom - footerHeight) {
          doc.addPage();
          currentY = pageTop;
        }
        drawHeader(currentY);
        currentY += rowHeight;

        // Draw rows and handle page breaks
        rows.forEach((row, rowIndex) => {
          // If next row doesn't fit, finish current page segment and start a new page
          if (currentY + rowHeight > pageBottom - footerHeight) {
            // Draw borders for the segment we just wrote
            doc.strokeColor('#cccccc').lineWidth(0.5);
            // vertical lines for this segment
            for (let i = 0; i <= headers.length; i++) {
              doc.moveTo(x + (i * colWidth), segmentStartY)
                 .lineTo(x + (i * colWidth), currentY)
                 .stroke();
            }
            // horizontal lines for this segment
            const rowsInSegment = Math.floor((currentY - segmentStartY) / rowHeight);
            for (let i = 0; i <= rowsInSegment; i++) {
              doc.moveTo(x, segmentStartY + (i * rowHeight))
                 .lineTo(x + width, segmentStartY + (i * rowHeight))
                 .stroke();
            }

            // Add new page and redraw header
            doc.addPage();
            currentY = pageTop;
            segmentStartY = currentY;
            drawHeader(currentY);
            currentY += rowHeight;
          }

          // Alternate row background
          if (rowIndex % 2 === 0) {
            doc.fillColor('#f8f8f8');
            doc.rect(x, currentY, width, rowHeight).fill();
            doc.fillColor('black');
          }

          row.forEach((cell, cellIndex) => {
            doc.font('Helvetica')
               .fontSize(7)
               .text(cell || 'N/A', x + (cellIndex * colWidth) + 3, currentY + 3, {
                 width: colWidth - 6,
                 align: 'left'
               });
          });

          currentY += rowHeight;
        });

        // Draw borders for the final segment
        doc.strokeColor('#cccccc').lineWidth(0.5);
        for (let i = 0; i <= headers.length; i++) {
          doc.moveTo(x + (i * colWidth), segmentStartY)
             .lineTo(x + (i * colWidth), currentY)
             .stroke();
        }
        const finalRowsInSegment = Math.floor((currentY - segmentStartY) / rowHeight);
        for (let i = 0; i <= finalRowsInSegment; i++) {
          doc.moveTo(x, segmentStartY + (i * rowHeight))
             .lineTo(x + width, segmentStartY + (i * rowHeight))
             .stroke();
        }

        // sync pdfkit internal y position and return
        try { doc.y = currentY; } catch (e) { /* ignore */ }
        return currentY + 5;
      }

      // Simplified dynamic table for long text - page-break aware
      function drawDynamicTable(x, y, width, headers, rows, options = {}) {
        const colWidths = options.colWidths || headers.map(() => width / headers.length);
        const minRowHeight = options.minRowHeight || 18;
        let currentY = y;
        const pageTop = doc.page.margins.top || 40;
        const pageBottom = doc.page.height - (doc.page.margins.bottom || 40);

        // draw header at given Y
        function drawHeader(atY) {
          doc.fillColor('#e0e0e0');
          doc.rect(x, atY, width, minRowHeight).fill();
          doc.fillColor('black');
          let currentX = x;
          headers.forEach((header, i) => {
            doc.font('Helvetica-Bold')
               .fontSize(8)
               .text(header, currentX + 3, atY + 3, {
                 width: colWidths[i] - 6,
                 align: 'left'
               });
            currentX += colWidths[i];
          });
        }

        let segmentStartY = currentY;
        // Ensure there's room for header + at least one data row; if not, start a new page.
        if (currentY + minRowHeight + minRowHeight > pageBottom) {
          doc.addPage();
          currentY = pageTop;
        }
        drawHeader(currentY);
        currentY += minRowHeight;
        console.log('[PDF DEBUG] drawDynamicTable initial currentY=', currentY, 'pageBottom=', pageBottom, 'colWidths=', colWidths);

        rows.forEach((row, rowIndex) => {
          if (!Array.isArray(row)) {
            console.log('[PDF DEBUG] drawDynamicTable row is not array, rowIndex=', rowIndex, 'row=', row);
          }
           // Calculate row height based on rendered text height for each cell
           let rowHeight = minRowHeight;
          row.forEach((cell, cellIndex) => {
            const text = (cell === undefined || cell === null) ? 'N/A' : cell.toString();
            // Ensure consistent font metrics while measuring
            doc.font('Helvetica').fontSize(7);
            try {
              const measuredHeight = doc.heightOfString(text, { width: (colWidths[cellIndex] || colWidths[0]) - 6 });
              // Add small vertical padding
              rowHeight = Math.max(rowHeight, measuredHeight + 6);
            } catch (e) {
              // Fallback to heuristic if measurement fails for any reason
              if (text.length > 50) {
                rowHeight = Math.min(120, minRowHeight + Math.floor(text.length / 60) * 8);
              }
            }
          });
          // Cap row height to avoid extremely tall rows
          rowHeight = Math.min(rowHeight, 160);

          // If row won't fit on the page, finish segment and add new page with header
          if (currentY + rowHeight > pageBottom) {
            // borders for the current segment
            doc.strokeColor('#cccccc').lineWidth(0.5);
            // outline for this segment
            doc.rect(x, segmentStartY, width, currentY - segmentStartY).stroke();
            // vertical lines
            let currX = x;
            colWidths.forEach(colWidth => {
              currX += colWidth;
              doc.moveTo(currX, segmentStartY).lineTo(currX, currentY).stroke();
            });

            doc.addPage();
            currentY = pageTop;
            segmentStartY = currentY;
            drawHeader(currentY);
            currentY += minRowHeight;
          }

          // Alternate background
          if (rowIndex % 2 === 0) {
            doc.fillColor('#f8f8f8');
            doc.rect(x, currentY, width, rowHeight).fill();
            doc.fillColor('black');
          }

          let currentX = x;
          row.forEach((cell, cellIndex) => {
            doc.font('Helvetica')
                .fontSize(7)
                .text(cell || 'N/A', currentX + 3, currentY + 3, {
                  width: colWidths[cellIndex] - 6,
                  align: 'left'
                });
            currentX += colWidths[cellIndex];
          });

          currentY += rowHeight;
        });

        // Draw borders for the final segment
        doc.strokeColor('#cccccc').lineWidth(0.5);
        doc.rect(x, segmentStartY, width, currentY - segmentStartY).stroke();
        let currX = x;
        colWidths.forEach(colWidth => {
          currX += colWidth;
          doc.moveTo(currX, segmentStartY).lineTo(currX, currentY).stroke();
        });

        // sync pdfkit internal y position and return
        try { doc.y = currentY; } catch (e) { /* ignore */ }
        return currentY + 5;
      }

      // Auto table wrapper - use internal drawDynamicTable to ensure predictable behavior
      function drawAutoTable(x, y, width, headers, rows, options = {}) {
        console.log('[PDF DEBUG] drawAutoTable called headers=', headers, 'rowsCount=', Array.isArray(rows) ? rows.length : typeof rows);
        try { console.log('[PDF DEBUG] drawAutoTable rows sample:', Array.isArray(rows) ? rows.slice(0,3) : rows); } catch (e) { console.log('[PDF DEBUG] drawAutoTable sample error', e); }
        return drawDynamicTable(x, y, width, headers, rows, options);
      }

      // Title
      doc.font('Helvetica-Bold')
         .fontSize(20)
         .text('Annexure – I', { align: 'center' });
      doc.moveDown(0.3);
      doc.fontSize(14)
         .text('Details of Hospital for Empanelment', { align: 'center' });
      doc.moveDown(1);

      let currentY = doc.y;

      // Section A: Hospital Details
      doc.font('Helvetica-Bold')
         .fontSize(12)
         .fillColor('#2c3e50')
         .text('A. Details of the Hospital', 40, currentY);
      doc.fillColor('black');
      currentY += 18;

      currentY = drawTable(40, currentY, 515,
        ['Field', 'Details'],
        [
          ['Name of the Hospital', mainDetails.name],
          ['City where Hospital is located', mainDetails.city],
          ['Address of the Hospital', mainDetails.address],
          ['Telephone No.', mainDetails.telephone],
          ['Mobile No.', mainDetails.mobile],
          ['Fax Number', mainDetails.fax],
          ['Email Address', mainDetails.email]
        ]
      );

      // Medical Superintendent Details
      doc.font('Helvetica-Bold')
         .fontSize(10)
         .text('Medical Superintendent Details:', 40, currentY);
      currentY += 15;

      currentY = drawTable(40, currentY, 515,
        ['Field', 'Details'],
        [
          ['Name of Medical Superintendent/RMO', mainDetails.superintendent_name],
          ['Contact Details', mainDetails.superintendent_contact],
          ['Email ID', mainDetails.superintendent_email],
          ['Telephone No./Mobile No.', mainDetails.superintendent_phone]
        ]
      );

      // Section B: NABH Accreditation
      doc.font('Helvetica-Bold')
         .fontSize(12)
         .fillColor('#2c3e50')
         .text('B. Details of NABH Accreditation', 40, currentY);
      doc.fillColor('black');
      currentY += 18;

      currentY = drawTable(40, currentY, 515,
        ['Parameter', 'Status'],
        [['Whether NABH Accredited', metadata.nabh_accredited || 'N/A']]
      );

      // Section C: Services Applied for
      doc.font('Helvetica-Bold')
         .fontSize(12)
         .fillColor('#2c3e50')
         .text('C. Details of Services Applied for', 40, currentY);
      doc.fillColor('black');
      currentY += 18;

      let specialties = [];
      if (metadata.specialties) {
        try {
          specialties = typeof metadata.specialties === 'string' ?
            JSON.parse(metadata.specialties) : metadata.specialties;
        } catch (e) {
          specialties = [];
        }
      }

      if (Array.isArray(specialties) && specialties.length > 0) {
        currentY = drawAutoTable(40, currentY, 515,
          ['S.No', 'Name of the Specialty', 'Head of the Department'],
          specialties.map((s, idx) => [
            (idx + 1).toString(),
            s.name || 'N/A',
            s.head || 'N/A'
          ]),
          { colWidths: [40, 300, 175], minRowHeight: 18 }
        );
      } else {
        doc.fontSize(8).text('No specialties provided', 40, currentY);
        currentY += 15;
      }

      // Section D: Availability of Doctors
      doc.font('Helvetica-Bold')
         .fontSize(12)
         .fillColor('#2c3e50')
         .text('D. Availability of Doctors', 40, currentY);
      doc.fillColor('black');
      currentY += 18;

      currentY = drawTable(40, currentY, 515,
        ['Category', 'Number'],
        [
          ['Number of Full time Specialists', metadata.full_time_specialists],
          ['Number of Duty Doctors', metadata.duty_doctors],
          ['Number of Resident Medical Officers', metadata.resident_medical_officers],
          ['Number of Super specialists (if any)', metadata.super_specialists],
          ['Number of Doctors on Call', metadata.doctors_on_call]
        ]
      );

      // Section E: Nursing Care
      doc.font('Helvetica-Bold')
         .fontSize(12)
         .fillColor('#2c3e50')
         .text('E. Details of Nursing Care', 40, currentY);
      doc.fillColor('black');
      currentY += 18;

      currentY = drawTable(40, currentY, 515,
        ['Parameter', 'Details'],
        [
          ['Total No of Nurses', metadata.total_nurses],
          ['Name of the Nursing Superintendent', metadata.nursing_superintendent],
          ['Patient: Nurse Ratio - General Ward (Norm 6:1)', metadata.patient_nurse_ratio_general],
          ['Patient: Nurse Ratio - ICCU/ICU (Norm 1:1)', metadata.patient_nurse_ratio_icu]
        ]
      );

      // Section F: Other Staff
      doc.font('Helvetica-Bold')
         .fontSize(12)
         .fillColor('#2c3e50')
         .text('F. Details of Other Staff', 40, currentY);
      doc.fillColor('black');
      currentY += 18;

      currentY = drawTable(40, currentY, 515,
        ['Staff Category', 'Number'],
        [
          ['No of Lab Technicians', metadata.lab_technicians],
          ['No of Radiographers', metadata.radiographers],
          ['No of Physiotherapists', metadata.physiotherapists],
          ['No of Dieticians', metadata.dieticians],
          ['No of Administrative Staff', metadata.admin_staff],
          ['No of House Keeping Staff', metadata.house_keeping],
          ['No of Security Personnel', metadata.security]
        ]
      );

      // Section G: Infrastructure Details
      doc.font('Helvetica-Bold')
         .fontSize(12)
         .fillColor('#2c3e50')
         .text('G. Infrastructure Details of the Hospital', 40, currentY);
      doc.fillColor('black');
      currentY += 18;

      currentY = drawTable(40, currentY, 515,
        ['Infrastructure Parameter', 'Details'],
        [
          ['Total No. of Beds', metadata.total_beds],
          ['No of Beds in the Casualty/Emergency', metadata.casualty_beds],
          ['No of Beds in ICCU/ICU/HDU', metadata.icu_beds],
          ['No of Ventilators', metadata.ventilators],
          ['No of General Ward Beds', metadata.general_ward_beds],
          ['Average Daily OPD Attendance', metadata.avg_opd_attendance],
          ['Average Bed Occupancy (%)', metadata.avg_bed_occupancy],
          ['Total Area of the Hospital (sq ft)', metadata.total_area],
          ['Area allotted to the OPD (sq ft)', metadata.opd_area],
          ['Area allotted to the IPD (sq ft)', metadata.ipd_area],
          ['No of Wards', metadata.wards],
          ['Dimensions of the Wards', metadata.ward_dimensions],
          ['Alternate Power Source', metadata.alt_power]
        ]
      );

      // Section H: Laboratory Services
      doc.font('Helvetica-Bold')
         .fontSize(12)
         .fillColor('#2c3e50')
         .text('H. Details of Laboratory Services', 40, currentY);
      doc.fillColor('black');
      currentY += 18;

      currentY = drawTable(40, currentY, 515,
        ['Department', 'Head of the Department'],
        [
          ['Biochemistry', metadata.biochemistry_head],
          ['Pathology', metadata.pathology_head],
          ['Microbiology', metadata.microbiology_head]
        ]
      );

      // Section I: Imaging Facilities
      doc.font('Helvetica-Bold')
         .fontSize(12)
         .fillColor('#2c3e50')
         .text('I. Details of Imaging Facilities', 40, currentY);
      doc.fillColor('black');
      currentY += 18;

      currentY = drawTable(40, currentY, 515,
        ['Facility', 'Available (YES/NO)'],
        [
          ['X Ray', metadata.xray],
          ['Ultrasonography', metadata.ultrasonography],
          ['Mammography', metadata.mammography],
          ['CT Scan', metadata.ct_scan],
          ['MRI Scan', metadata.mri_scan]
        ]
      );

      // Section J: Operation Theatres
      doc.font('Helvetica-Bold')
         .fontSize(12)
         .fillColor('#2c3e50')
         .text('J. Details of Operation Theatres', 40, currentY);
      doc.fillColor('black');
      currentY += 18;

      currentY = drawTable(40, currentY, 515,
        ['Parameter', 'Details'],
        [
          ['Number of Operation Theatres', metadata.operation_theatres],
          ['Whether there is separate OT for Septic Cases', metadata.septic_ot],
          ['Whether OT facility available around the Clock', metadata.ot_24x7]
        ]
      );

      // Section K: Supportive Services
      doc.font('Helvetica-Bold')
         .fontSize(12)
         .fillColor('#2c3e50')
         .text('K. Details of Supportive Services', 40, currentY);
      doc.fillColor('black');
      currentY += 18;

      currentY = drawTable(40, currentY, 515,
        ['Service', 'Available (YES/NO)'],
        [
          ['Blood Bank', metadata.blood_bank],
          ['24 Hour Pharmacy', metadata.pharmacy_24hr],
          ['Physiotherapy', metadata.physiotherapy],
          ['CSSD', metadata.cssd],
          ['In-house Canteen', metadata.canteen],
          ['Gas Plant', metadata.gas_plant],
          ['Medical Records Department', metadata.medical_records]
        ]
      );


      // Section L: Other Tie Ups (using simplified dynamic table)
      doc.font('Helvetica-Bold')
         .fontSize(12)
         .fillColor('#2c3e50')
         .text('L. Details of other Tie Ups', 40, currentY);
      doc.fillColor('black');
      currentY += 18;

      currentY = drawAutoTable(40, currentY, 515,
        ['Tie Up Category', 'Status/Details'],
        [
          ['Whether your hospital is empaneled with CGHS', metadata.empaneled_cghs],
          ['Whether your hospital is recognized by State Govt. for Aarogyasri/EHS', metadata.recognized_aarogyasri],
          ['Any Tie Up with TPIs', metadata.tpi_tieup]
        ],
        {
          colWidths: [300, 215],
          minRowHeight: 18
        }
      );

      // Section M: Biomedical Waste Management
      doc.font('Helvetica-Bold')
         .fontSize(12)
         .fillColor('#2c3e50')
         .text('M. Details of Biomedical Waste Management', 40, currentY);
      doc.fillColor('black');
      currentY += 18;

      currentY = drawDynamicTable(40, currentY, 515,
        ['Parameter', 'Details'],
        [
          ['Whether your hospital is following the Biomedical waste management as per statutory requirements', metadata.biomedical_waste],
          ['Please Provide PCB License No', metadata.pcb_license]
        ],
        {
          colWidths: [350, 165],
          minRowHeight: 18
        }
      );

      // Section N: Bank Account Details
      doc.font('Helvetica-Bold')
         .fontSize(12)
         .fillColor('#2c3e50')
         .text('N. Details of Hospital Bank Account', 40, currentY);
      doc.fillColor('black');
      currentY += 18;

      currentY = drawTable(40, currentY, 515,
        ['Bank Details', 'Information'],
        [
          ['Name of the Bank', metadata.bank_name],
          ['Branch of the Bank', metadata.bank_branch],
          ['Account Number', metadata.account_number],
          ['IFSC Code', metadata.ifsc_code],
          ['MICR No.', metadata.micr_no]
        ]
      );

      // Footer
      doc.moveDown(1);
      doc.font('Helvetica-Oblique')
         .fontSize(9)
         .fillColor('#666666')
         .text('Generated by Hospital Enrollment System', { align: 'center' });

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

exports.createHospital = async (req) => {
  // Validate uploaded files: accept only PDFs and max size 10MB
  await this.verifyGoogleRecaptcha(req);

  if (req.files && req.files.length) {
    const MAX_BYTES = 10 * 1024 * 1024; // 10MB
    const suspiciousPreExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.svg', '.webp', '.heic', '.tif', '.tiff', '.exe', '.zip', '.rar', '.7z', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx']);

    for (const file of req.files) {
      const name = (file.originalname || '').toString();
      const mimetype = (file.mimetype || '').toString();

      // Use path.extname to get the real final extension
      const ext = path.extname(name).toLowerCase();
      const hasPdfExt = ext === '.pdf';

      // Detect a hidden/preceding extension like name.png.pdf
      const nameWithoutExt = name.slice(0, name.length - ext.length);
      const preExt = path.extname(nameWithoutExt).toLowerCase();
      // isDoubleExtension: true when there's a preceding extension (e.g. name.png.pdf)
      const isDoubleExtension = preExt !== '';
      const hasSuspiciousPreExt = suspiciousPreExtensions.has(preExt);

      // If there is a suspicious preceding extension (e.g. .png.pdf), reject immediately
      if (isDoubleExtension && hasSuspiciousPreExt) {
        const err = new Error('Only valid PDF files are allowed (no double extensions like .png.pdf)');
        err.status = 400;
        throw err;
      }

      // Check MIME and file signature. Prefer signature when available.
      const isPdfMime = mimetype === 'application/pdf';

      // Read buffer if not present (e.g., file saved to disk)
      let buffer = file.buffer;
      if (!buffer && file.path) {
        try {
          buffer = fs.readFileSync(file.path);
        } catch (e) {
          buffer = null;
        }
      }

      // Check PDF magic header and EOF marker from content when we have a buffer
      let isPdfSignature = false;
      if (buffer && buffer.length >= 5) {
        try {
          const header = buffer.slice(0, 5).toString('utf8'); // should be '%PDF-'
          const tailSlice = buffer.slice(Math.max(0, buffer.length - 1024)); // last up to 1KB
          const tailStr = tailSlice.toString('utf8');
          const hasPdfHeader = header === '%PDF-';
          const hasPdfEOF = /%%EOF/.test(tailStr);
          isPdfSignature = hasPdfHeader && hasPdfEOF;
        } catch (e) {
          isPdfSignature = false;
        }
      }

      // Final decision: must have .pdf final extension, must NOT have a suspicious preceding extension,
      // and at least one of (mime says pdf OR buffer signature looks like PDF).
      const isPdf = hasPdfExt && !hasSuspiciousPreExt && (isPdfMime || isPdfSignature);

      if (!isPdf) {
        const err = new Error('Only valid PDF files are allowed (no double extensions like .png.pdf)');
        err.status = 400;
        throw err;
      }

      const size = (typeof file.size === 'number') ? file.size : (buffer ? buffer.length : 0);
      if (size > MAX_BYTES) {
        const err = new Error('Only PDF files of size 10MB or less are allowed');
        err.status = 400;
        throw err;
      }
    }
  }

  const { mainDetails, metadata } = extractHospitalData(req.body);
  const db = hospitalRepository.getDb(); // Get DB connection (adjust as per your repo)
  const transaction = await db.transaction();

  try {
    const hospitalId = await hospitalRepository.insertHospital(mainDetails, metadata, { transaction });
    const documents = [];

    // Generate and store Annexure 1 PDF
    const pdfBuffer = await generateAnnexurePDF(mainDetails, metadata);
    const pdfDoc = await hospitalRepository.insertDocument('application', 'Annexure-1.pdf', hospitalId, pdfBuffer, { transaction });
    documents.push(pdfDoc);

    // Store uploaded files
    for (const file of req.files) {
      const type = file.fieldname;
      const doc = await hospitalRepository.insertDocument(type, file.originalname, hospitalId, file.buffer, { transaction });
      documents.push(doc);
    }

    await transaction.commit();
    return { hospital: { id: hospitalId, ...mainDetails, metadata, documents } };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

exports.verifyGoogleRecaptcha = async (req) => {

  if(req.body['recaptchaToken'] === undefined || req.body['recaptchaToken'] === '' || req.body['recaptchaToken'] === null) {
    throw new Error("Please select captcha");
  }

  const secretKey = process.env.GOOGLE_RECAPTCHA_SECRET_KEY;
    const recaptchaResponse = req.body['recaptchaToken'];

    // Verify URL
    const verifyUrl = `https://www.google.com/recaptcha/api/siteverify?secret=${secretKey}&response=${recaptchaResponse}&remoteip=${req.connection.remoteAddress}`;
    // Make request to verify URL
    const response = await fetch(verifyUrl, { method: 'POST' });
    const body = await response.json();

    if(body.success !== undefined && !body.success) {
        throw new Error("Failed captcha verification");
    }
}

exports.getHospitalsByStatus = async (status, page, limit) => {
  return await hospitalRepository.getHospitalsByStatus(status, page, limit);
};

exports.updateHospitalStatus = async (id, status) => {
  return await hospitalRepository.updateHospitalStatus(id, status);
};

exports.getDetailsByHospitalId = async (hospitalId) => {
    const hospitalInfo = await hospitalRepository.getHospitalsByHospitalId(hospitalId);
    const documents = await hospitalRepository.getDocumentsByHospitalId(hospitalId);
    return { hospital: hospitalInfo, documents: documents };
}

exports.getDocumentsByHospitalId = async (hospitalId) => {
  return await hospitalRepository.getDocumentsByHospitalId(hospitalId);
};

// Test-only export to allow generating the Annexure PDF from a script
exports._generateAnnexurePDF = generateAnnexurePDF;
