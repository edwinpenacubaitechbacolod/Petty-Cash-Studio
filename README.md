# Bacolod Warehouse — Petty Cash Studio

A GitHub Pages-ready, browser-based petty cash liquidation assistant, based on the provided `REF# 26-72 with sign.xlsx` layout.

## Features

- Upload multiple photos or PDFs of receipts, invoices, and petty cash vouchers.
- Run browser-based OCR to suggest transaction details.
- Crop a receipt from a scanned page containing multiple documents.
- Review/edit every field before export; add or duplicate entries manually.
- Leave unavailable fields genuinely **blank** (not `0`, `N/A`, or a guess).
- Enter VAT and amount excluding VAT **only when stated** in the document or manually verified.
- Export an `.xlsx` with a liquidation sheet and an `ATTACHMENTS` sheet containing the original supporting images.
- Download and restore local drafts as `.json` files.

## Deploy on GitHub Pages

1. Make a new GitHub repository (for example, `petty-cash-studio`). Do **not** upload real receipts, signed workbooks, or employee financial data to a public repository.
2. Upload these four website files to the repository root: `index.html`, `styles.css`, `app.js`, and `favicon.svg`.
3. In GitHub, open **Settings → Pages**. Select **Deploy from a branch**, then **main** and **/(root)**. Save.
4. Open the published Pages URL. If your repository is named `petty-cash-studio`, a typical project URL is `https://YOUR-USERNAME.github.io/petty-cash-studio/`.

The website is static: there is no login, database, private API key, or receipt-upload server. Documents are kept in the current browser tab. OCR and spreadsheet libraries are loaded from third-party CDNs, so an internet connection is needed for the full feature set.

## Typical workflow

1. Enter the reference number, liquidation period, prepared-by name, and optional default payee.
2. Upload supporting documents. For images holding multiple receipts, select **Crop receipt** and scan each receipt separately.
3. Check every suggested entry. Printed details tend to be easier to recognize than handwriting; missing or ambiguous values stay blank.
4. Generate the Excel report and verify the totals before submitting it for approval.

## Important limitations

- Browser OCR is not guaranteed to accurately read handwritten vouchers, faint receipts, or complex multi-receipt scans. **Manual verification is required**.
- A seller's printed name is not necessarily the payee who received the company's petty cash. Supply the payee manually when the supporting document does not establish it.
- VAT is never inferred just because the column heading says 12%. No tax classification or accounting eligibility determination is performed.
- The generated workbook follows the two-tab layout and column structure, but is a new unsigned report, not an exact copy of the historical signed file. Historic signatures are not reproduced.
- Deleting/refreshing the browser tab loses unsaved session data. Use **Save draft** for an editable local backup.
- The Excel and OCR functionality depends on script assets being available on the CDNs; for an offline version, those dependencies would need to be bundled locally.

## Privacy

Do **not** publish the supplied sample `.xlsx` or original scans in your GitHub repository. It includes actual supporting documents and signatures. This project ships with only the application code. No scanned receipts are included.
