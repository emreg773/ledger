# Ledger demo fixtures

All documents here are AI-generated samples with fictional data, made for the Ledger demo. They carry no visible sample marks; the PDFs say so in their metadata. Business: Taquería La Esquina LLC, owner María López, 1200 Ejemplo Ave, Oakland CA 94601. Fictional EIN: 12-3456789.

Folders:
- `photos/` phone-style photos (angled, shadowed, JPEG). Use these for the demo and tests.
- `clean/` flat scans (PNG, 150 dpi).
- `pdf/` scanned-style PDFs (image only), to test the PDF path.
- `source/` the HTML used to generate them.

## Expected extraction results

### cp14_photo.jpg / cp14.pdf (2 pages)
- docType `IRS_CP14`; issuer Internal Revenue Service (federal)
- noticeCode CP14; Form 941; tax period ending 2026-06-30
- noticeDate 2026-10-12; amountDue 1240.18; deadline 2026-11-02
- phone 800-829-4933; websites irs.gov/payments, irs.gov/paymentplan, irs.gov/cp14
- mailing address: Internal Revenue Service, Ogden UT 84201-0039
- identifiersMasked: EIN ending 6789

### 972cg_photo_page1.jpg + page2 / 972cg.pdf (2 pages)
- docType `IRS_972CG`; issuer Internal Revenue Service (federal)
- noticeDate 2026-10-05; tax year 2025
- amountDue 520.00 (4 late Forms 1099-NEC at $130 each); deadline 2026-11-19
- phone 800-829-4933; address Philadelphia PA 19255-0000
- Masking test: page 2 prints the full fictional EIN 12-3456789. Ledger must store and show only the last 4 (6789).

### cp504b_photo.jpg / cp504b.pdf (2 pages)
- docType `IRS_CP504` (printed code CP504B, the business version)
- Form 941; tax period ending 2026-06-30 (same form and period as the CP14)
- noticeDate 2026-12-07; amountDue 1262.40; deadline 2027-01-06
- phone 800-829-4933; mentions the earlier notice dated 2026-10-12
- Case memory: links to the CP14 case. With the seeded Oct 2 payment of $1,240.18, Ledger says it's the second notice for the same tax and recommends calling again instead of paying.

### inspection_yellow_photo.jpg / inspection_yellow.pdf
- docType `COUNTY_HEALTH_INSPECTION`; issuer Alameda County Department of Environmental Health (county)
- placard yellow; score 77; inspection 2026-10-21; reinspection 2026-10-28
- 3 major violations, all corrected on site; 7 minor violations
- phone (510) 567-6700; address 1131 Harbor Bay Parkway, Alameda CA 94502

### scam_irs_photo.jpg (scam test)
- A fake "Internal Revenue Tax Enforcement Division" letter demanding $2,980 in gift cards or Bitcoin within 48 hours
- Must not be classified as a real IRS notice type
- The scam check must flag: gift cards and crypto, the 48-hour arrest threat, "don't contact your accountant", the 555 phone number, the non-government email domain, and the agency name that doesn't exist

### menu_photo.jpg
- docType `UNKNOWN`; Ledger says it can't help with this document
