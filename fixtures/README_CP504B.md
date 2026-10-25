# Added fixture: IRS CP504B (follow-up to the CP14), FAKE

Copy these into `fixtures/` (photos/, pdf/, clean/, source/) and append this section to `fixtures/README.md`.

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
