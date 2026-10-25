# Ledger test fixtures (all FAKE)

Every document here is fictional and watermarked SAMPLE. Business: Taquería La Esquina LLC, owner María López, 1200 Ejemplo Ave, Oakland CA 94601. Fake EIN: 12-3456789.

Folders:
- `photos/` phone-style photos (angled, shadowed, JPEG). Use these for the main demo and tests.
- `clean/` flat scans (PNG, 150 dpi).
- `pdf/` scanned-style PDFs (image-only), to test the PDF path.
- `source/` HTML used to generate them. Edit and re-render if you need variants.

## Expected extraction results (ground truth)

### cp14_photo.jpg / cp14.pdf (2 pages)
- docType: `IRS_CP14`, issuer: Internal Revenue Service (federal)
- noticeCode: CP14, form 941, tax period ending 2026-06-30
- noticeDate: 2026-10-12
- amountDue: 1240.18 (tax 9,380.00 minus payments 8,200.00, plus penalty 35.40, plus interest 24.78)
- deadline: 2026-11-02
- phones: 800-829-4933. Websites: irs.gov/payments, irs.gov/paymentplan, irs.gov/cp14
- mailing address: Internal Revenue Service, Ogden UT 84201-0039
- identifiersMasked: EIN ending 6789 (letter already shows XX-XXX6789)

### 972cg_photo_page1.jpg + page2 / 972cg.pdf (2 pages)
- docType: `IRS_972CG`, issuer: Internal Revenue Service (federal)
- noticeDate: 2026-10-05, tax year 2025
- amountDue: 520.00 (proposed penalty: 4 late Forms 1099-NEC at $130 each)
- deadline: 2026-11-19 (respond within 45 days)
- phones: 800-829-4933. Address: Philadelphia PA 19255-0000
- **Masking test:** page 2 prints the FULL fake EIN 12-3456789. Ledger must store and show it only as last 4 (6789).

### inspection_yellow_photo.jpg / inspection_yellow.pdf
- docType: `COUNTY_HEALTH_INSPECTION`, issuer: Alameda County Department of Environmental Health (county)
- placardColor: yellow, score: 77, inspection date 2026-10-21, reinspectionDate: 2026-10-28
- 3 major violations, all corrected on site: hot holding (beans at 118°F, needs 135°F+), blocked handwashing sink with no soap, raw chicken stored above ready-to-eat food
- 7 minor violations: wiping cloths, no thermometer in reach-in, 2 missing food handler cards, personal items above prep table, grease under fryer, missing light shield, unlabeled bulk containers
- phone: (510) 567-6700. Address: 1131 Harbor Bay Parkway, Alameda CA 94502

### scam_irs_photo.jpg (scam test)
- Fake "Internal Revenue Tax Enforcement Division" letter demanding $2,980 in gift cards or Bitcoin within 48 hours
- Step 1: should NOT be classified as CP14/CP504/972CG (no real notice code)
- Step 2 scam check must flag: gift card and crypto payment, 48-hour arrest threat, "don't contact your accountant", 555 phone number, non-government email domain, agency name that doesn't exist

### menu_photo.jpg
- docType: `UNKNOWN`. Ledger should say it can't help with this document.

### cp14_blurry_photo.jpg
- overallConfidence should be below 0.6. Ledger should ask for a clearer photo instead of explaining.

### cp504b_photo.jpg / cp504b.pdf (2 pages)
- docType: `IRS_CP504` (the printed code is CP504B, the business version; classify it as IRS_CP504)
- issuer: Internal Revenue Service (federal)
- noticeCode: CP504B, form 941, tax period ending 2026-06-30 (**same form and period as the CP14**)
- noticeDate: 2026-12-07
- amountDue: 1262.40 (tax 9,380.00 minus payments 8,200.00, plus penalty 47.20, plus interest 35.20)
- deadline: 2027-01-06 (30 days from the notice date)
- phone: 800-829-4933. Websites: irs.gov/payments, irs.gov/paymentplan
- identifiersMasked: EIN ending 6789
- The letter mentions the earlier notice dated 2026-10-12 (the CP14)

**Case memory expectation:** links to the CP14 case (same EIN last 4, Form 941, period 2026-06-30). With the seeded Oct 2 payment of $1,240.18, Ledger should say this is the second notice for the same tax, that the bank shows the October 2 payment, and recommend calling again instead of paying.

## Official contacts for the Step 2 allowlist
- IRS Business and Specialty Tax Line: 800-829-4933 (listed on irs.gov). Domain: irs.gov
- Alameda County Dept. of Environmental Health: (510) 567-6700, 1131 Harbor Bay Parkway, Alameda CA 94502 (from county documents; confirm on the county site before relying on it)
- The IRS mailing addresses on these samples (Ogden 84201, Philadelphia 19255) are plausible but were not verified against current IRS notices.
