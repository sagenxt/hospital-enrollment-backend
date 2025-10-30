const PDFDocument = require('pdfkit');
// pdfkit-table is an optional helper for robust table rendering across pages
try {
  require('pdfkit-table');
} catch (e) {
  // not installed - dynamic table fallback will be used
}

const hospitalRepository = require('../repositories/hospitalRepository');

function extractHospitalData(body) {
  const mainDetails = {
    name: body.name,
    city: body.city,
    address: body.address,
    telephone: body.telephone,
    mobile: body.mobile,
    fax: body.fax,
    email: body.email,
    superintendent_name: body.superintendent_name,
    superintendent_contact: body.superintendent_contact,
    superintendent_email: body.superintendent_email,
    superintendent_phone: body.superintendent_phone
  };
  const metadata = { ...body };
  for (const key of Object.keys(mainDetails)) {
    delete metadata[key];
  }
  return { mainDetails, metadata };
}

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
        drawHeader(currentY);
        currentY += rowHeight;

        // Draw rows and handle page breaks
        rows.forEach((row, rowIndex) => {
          // If next row doesn't fit, finish current page segment and start a new page
          if (currentY + rowHeight > pageBottom) {
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
        drawHeader(currentY);
        currentY += minRowHeight;

        rows.forEach((row, rowIndex) => {
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

        return currentY + 5;
      }

      // Prefer library table renderer when available to avoid subtle ordering issues
      function drawAutoTable(x, y, width, headers, rows, options = {}) {
        // If pdfkit-table is installed it augments doc with .table
        if (typeof doc.table === 'function') {
          const table = { headers: headers, rows: rows };
          // Call synchronously; many pdfkit-table implementations render synchronously and update doc.y
          try {
            doc.table(table, { x: x, width: width, prepareHeader: () => doc.font('Helvetica-Bold').fontSize(8), columnSpacing: 5, padding: 3 });
          } catch (e) {
            // If synchronous call fails, fall back to internal renderer
            return drawDynamicTable(x, y, width, headers, rows, options);
          }
          return doc.y + 5;
        }

        // fallback to internal implementation
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

      // Check for new page
      if (currentY > 720) {
        doc.addPage();
        currentY = 40;
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

      // Check for new page
      if (currentY > 720) {
        doc.addPage();
        currentY = 40;
      }

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

      // Check for new page
      if (currentY > 650) {
        doc.addPage();
        currentY = 40;
      }

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

      // Check for new page
      if (currentY > 650) {
        doc.addPage();
        currentY = 40;
      }

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

exports.getHospitalsByStatus = async (status, page, limit) => {
  return await hospitalRepository.getHospitalsByStatus(status, page, limit);
};

exports.updateHospitalStatus = async (id, status) => {
  return await hospitalRepository.updateHospitalStatus(id, status);
};

exports.getDocumentsByHospitalId = async (hospitalId) => {
  return await hospitalRepository.getDocumentsByHospitalId(hospitalId);
};

// Test-only export to allow generating the Annexure PDF from a script
exports._generateAnnexurePDF = generateAnnexurePDF;
