/* Bacolod Warehouse Petty Cash Studio.
   All document processing and spreadsheet creation happen in the browser. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const state = { documents: [], entries: [], queue: [], scanning: false, cropping: null };
  const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });
  const newId = () => (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const html = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const compact = (value) => String(value || '').trim().replace(/\s+/g, ' ');
  const number = (v) => v === '' || v == null ? null : (Number.isFinite(Number(String(v).replace(/,/g,''))) ? Number(String(v).replace(/,/g,'')) : null);
  const safeNum = (v) => number(v) ?? 0;
  let toastTimer;
  function toast(message, isError = false) {
    const node = $('toast'); node.textContent = message; node.classList.toggle('error', isError);
    node.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove('show'), 4500);
  }
  function details() {
    return {
      reference: $('reference').value.trim(), from: $('periodFrom').value, to: $('periodTo').value,
      preparedBy: $('preparedBy').value.trim(), defaultPayee: $('defaultPayee').value.trim(),
      approvers: $('approvers').value.trim()
    };
  }
  function blankEntry(sourceId = '') {
    return { id:newId(), sourceId, date:'', payee:details().defaultPayee, company:'', tin:'', receipt:'', amount:'', vat:'', net:'', particulars:'' };
  }
  function fmt(value) { return money.format(safeNum(value)); }
  function summary() {
    $('documentCount').textContent = state.documents.filter(d => d.attachment).length;
    $('entryCount').textContent = state.entries.length;
    $('reviewCount').textContent = `${state.entries.length} ${state.entries.length === 1 ? 'entry' : 'entries'} to review`;
    const total = state.entries.reduce((sum, e) => sum + safeNum(e.amount), 0);
    $('totalAmount').textContent = fmt(total);
    $('tableTotal').textContent = fmt(total);
  }
  function renderEntries() {
    const tbody = $('entryRows');
    if (!state.entries.length) {
      tbody.innerHTML = '<tr><td colspan="11" class="empty-table">No transactions yet. Upload a document or add an entry manually.</td></tr>';
      summary(); return;
    }
    const fields = [
      ['date','date','Date'],['payee','text','Payee'],['company','text','Company'],
      ['tin','text','TIN'],['receipt','text','OR / SI'],['amount','number','0.00'],
      ['vat','number','Blank if absent'],['net','number','Blank if absent'],['particulars','text','Purpose of expense']
    ];
    tbody.innerHTML = state.entries.map((e,i) => `<tr data-row="${html(e.id)}"><td>${i+1}</td>${fields.map(([field,type,placeholder]) => `<td><input aria-label="Entry ${i+1} ${html(field)}" data-field="${field}" type="${type}" ${type==='number' ? 'step="0.01" min="0"' : ''} placeholder="${html(placeholder)}" value="${html(e[field])}"></td>`).join('')}<td><div class="row-actions"><button data-action="duplicate" title="Duplicate entry" aria-label="Duplicate entry">⧉</button><button data-action="remove" class="danger" title="Delete entry" aria-label="Delete entry">×</button></div></td></tr>`).join('');
    summary();
  }
  function renderDocuments() {
    const docs = state.documents;
    $('documentList').innerHTML = docs.map(d => `<article class="document-card" data-document="${html(d.id)}"><div class="thumb"><img src="${d.dataUrl}" alt="Preview of ${html(d.name)}"><span>${d.attachment ? 'Supporting document' : 'Crop / working copy'}</span></div><div class="info"><div class="doc-title" title="${html(d.name)}">${html(d.name)}</div><div class="doc-status">${html(d.status || 'Ready for review')}</div><div class="doc-actions"><button data-action="add">+ Entry</button><button data-action="crop">▣ Crop receipt</button><button data-action="remove" class="remove">Remove</button></div></div></article>`).join('');
    if (!docs.length) $('scanMessage').textContent = 'No documents added yet.';
    else $('scanMessage').textContent = `${docs.filter(d => d.attachment).length} supporting document(s) added. Click a preview to inspect it.`;
    summary();
  }
  function setDocumentStatus(doc, status) { doc.status = status; renderDocuments(); }
  function imageSize(src) {
    return new Promise((resolve,reject) => { const im = new Image(); im.onload=()=>resolve({width:im.naturalWidth,height:im.naturalHeight}); im.onerror=reject; im.src=src; });
  }
  function readDataUrl(file) {
    return new Promise((resolve,reject) => { const r=new FileReader(); r.onload=()=>resolve(r.result); r.onerror=reject; r.readAsDataURL(file); });
  }
  function canvasPng(src, widthLimit=1900) {
    return new Promise((resolve,reject) => {
      const im=new Image(); im.onload=()=>{
        const scale=Math.min(1,widthLimit/im.naturalWidth);
        const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(im.naturalWidth*scale));canvas.height=Math.max(1,Math.round(im.naturalHeight*scale));
        canvas.getContext('2d').drawImage(im,0,0,canvas.width,canvas.height);
        resolve({dataUrl:canvas.toDataURL('image/png'),width:canvas.width,height:canvas.height});
      }; im.onerror=reject; im.src=src;
    });
  }
  async function addDocument(dataUrl, name, attachment=true, scan=true) {
    const size=await imageSize(dataUrl);
    const doc={id:newId(),name,dataUrl,width:size.width,height:size.height,attachment,status:scan?'Queued for OCR':'Awaiting entry',ocrText:''};
    state.documents.push(doc);
    if(scan) {
      const entry=blankEntry(doc.id);state.entries.push(entry);renderEntries();
      state.queue.push({docId:doc.id,entryId:entry.id});
    }
    renderDocuments();
    if(scan) void pumpOCR();
    return doc;
  }
  async function handleFiles(files) {
    let failed=0;
    for(const file of files) {
      if(file.size>45*1024*1024){toast(`${file.name}: file too large (45 MB max).`,true);failed++;continue;}
      try {
        if(file.type==='application/pdf' || /\.pdf$/i.test(file.name)) {
          if(!window.pdfjsLib) throw new Error('PDF reader unavailable. Check your internet connection.');
          window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
          const pdf=await window.pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise;
          for(let i=1;i<=pdf.numPages;i++) {
            const page=await pdf.getPage(i);const view=page.getViewport({scale:1});
            const scale=Math.min(2.2,1650/view.width);const viewport=page.getViewport({scale});
            const canvas=document.createElement('canvas');canvas.width=Math.round(viewport.width);canvas.height=Math.round(viewport.height);
            await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
            await addDocument(canvas.toDataURL('image/png'),`${file.name} · page ${i}`);
            canvas.width=1;canvas.height=1;
          }
        } else if(/^image\/(png|jpeg|webp)$/.test(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name)) {
          const img=await canvasPng(await readDataUrl(file));
          await addDocument(img.dataUrl,file.name);
        } else {toast(`Unsupported file type: ${file.name}`,true);failed++;}
      } catch(err) {console.error(err);toast(`Could not read ${file.name}: ${err.message}`,true);failed++;}
    }
    if(files.length && failed<files.length) toast('Documents added. Please review the scanned values before export.');
  }
  // Conservative OCR. Missing / ambiguous fields deliberately stay blank.
  function parseDate(text) {
    const found=[];let match;
    const numeric=/\b(\d{1,4})[\/-](\d{1,2})[\/-](\d{2,4})\b/g;
    while((match=numeric.exec(text))) {
      let [,a,b,c]=match; let year,month,day;
      if(a.length===4){year=+a;month=+b;day=+c;}else{year=+c;year=year<100?2000+year:year;month=+a;day=+b;}
      if(year<2024||year>new Date().getFullYear()+2||month<1||month>12||day<1||day>31)continue;
      const dt=new Date(Date.UTC(year,month-1,day));if(dt.getUTCMonth()!==month-1||dt.getUTCDate()!==day)continue;
      const context=text.slice(Math.max(0,match.index-25),match.index).toUpperCase();
      let priority=/DATE|TRANS|ISSUED|PAYMENT/.test(context)?3:1;
      if(/EXPIRY|PERMIT|BIR|PTU|AUTHORITY/.test(context))priority=-1;
      found.push({date:`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`,priority,index:match.index});
    }
    const months={JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12};
    const words=/\b(JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUN(?:E)?|JUL(?:Y)?|AUG(?:UST)?|SEP(?:T(?:EMBER)?)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?)\.?\s*(\d{1,2})(?:,|\s)+\s*(20\d{2})\b/ig;
    while((match=words.exec(text))) {const mo=months[match[1].slice(0,3).toUpperCase()]; if(mo && +match[2]<=31)found.push({date:`${match[3]}-${String(mo).padStart(2,'0')}-${match[2].padStart(2,'0')}`,priority:2,index:match.index});}
    found.sort((a,b)=>b.priority-a.priority||a.index-b.index);
    return found[0]?.date||'';
  }
  function oneLabeledAmount(text, label) {
    const m=text.match(new RegExp(label+'(?:\\s*\\([A-Z]\\))?\\s*[:.\\-]?\\s*(?:PHP|PHP\\.|P|₱)?\\s*([\\d,]+(?:\\.\\d{1,2})?)','im'));
    return m ? Number(m[1].replace(/,/g,'')) : null;
  }
  function parseDocument(text) {
    const lines=text.split(/\r?\n/).map(compact).filter(Boolean);
    const caps=text.toUpperCase();
    const result={date:parseDate(text),payee:'',company:'',tin:'',receipt:'',amount:'',vat:'',net:'',particulars:''};
    const tinMatch=caps.match(/(?:VAT\s*REG\.?\s*)?TIN\s*(?:NO\.?|#|:|-)?\s*([\d]{3}[\s-]?[\d]{3}[\s-]?[\d]{3}[\s-]?[\d]{4,5})/);
    if(tinMatch)result.tin=tinMatch[1].replace(/\s/g,'-');
    const receiptPatterns=[/(?:INV\s*#|INV(?:OICE)?\s*(?:NO|NUMBER|#))\s*[:.#-]?\s*([A-Z]?\s?\d{4,11})/i,/(?:OR|S\.?I\.?)\s*(?:NO\.?|#)\s*[:.#-]?\s*([A-Z]?\s?\d{4,11})/i];
    for(const p of receiptPatterns){const m=text.match(p);if(m){result.receipt=compact(m[1]);break;}}
    const isVoucher=/PETTY\s+CASH\s+VOUCHER/i.test(text);
    if(!isVoucher) {
      const skip=/\b(INVOICE|RECEIPT|CASH SALES|VAT|AMOUNT|DATE|SOLD|TRANSACTION|TOTAL|PHILIPPINES|BIR|MABINI|BRGY|STREET|BACOLOD CITY)\b/i;
      const candidate=lines.slice(0,9).find(line=>line.length>6&&line.length<70&&/[A-Z]{3}/i.test(line)&&!skip.test(line)&&!/^\W|^\d/.test(line));
      if(candidate)result.company=candidate.toUpperCase();
    }
    const countVoucher=(caps.match(/PETTY\s+CASH\s+VOUCHER/g)||[]).length;
    const totalLines=lines.filter(l=>/^\s*(?:GRAND\s+TOTAL|TOTAL\s+AMOUNT\s+DUE|TOTAL\s+DUE|AMOUNT\s+DUE|TOTAL\s*(?:SALES)?)\s*(?:(?:PHP|₱|P)\s*)?[\d,.]+\s*$/i.test(l));
    const candidates=[];
    for(const line of totalLines){const m=line.match(/(?:PHP|₱)?\s*([\d,]+\.\d{2}|\d{2,6})\s*$/i);if(m)candidates.push(Number(m[1].replace(/,/g,'')));}
    if(countVoucher<=1 && candidates.length && new Set(candidates).size===1)result.amount=String(candidates[0]);
    if(countVoucher===1 && !result.amount){const m=caps.match(/AMOUNT\s*\n?\s*([\d,]+(?:\.\d{2})?)/);if(m)result.amount=String(Number(m[1].replace(/,/g,'')));}
    // Only explicitly itemized VAT values are copied; VAT is NOT inferred from total.
    const vat=oneLabeledAmount(text,'(?:VAT\\s*\\(12%\\)|12%\\s*VAT|VAT\\s*AMOUNT|ADD\\s*VAT)');
    const net=oneLabeledAmount(text,'(?:VATABLE\\s*(?:SALE|SALES)|NET\\s*OF\\s*VAT)');
    if(vat!==null && vat>=0)result.vat=String(vat);
    if(net!==null && net>=0)result.net=String(net);
    const vocab=[['PORTER TIP','PORTER TIP'],['ALLOWANCE','ALLOWANCE'],['TRICYCLE FARE','TRICYCLE FARE'],['TERMINAL FEE','TERMINAL FEE'],['FREIGHT','FREIGHT'],['DIESEL','DIESEL REFILL'],['GASOLINE','GASOLINE REFILL'],['BUS FARE','BUS FARE'],['SIMCARD','SIM CARD']];
    const hits=vocab.filter(([key])=>caps.includes(key));if(hits.length===1)result.particulars=hits[0][1];
    return result;
  }
  async function pumpOCR() {
    if(state.scanning)return;state.scanning=true;
    let worker;
    try {
      while(state.queue.length) {
        const {docId,entryId}=state.queue.shift();const doc=state.documents.find(d=>d.id===docId),entry=state.entries.find(e=>e.id===entryId);
        if(!doc||!entry)continue;
        if(!window.Tesseract){setDocumentStatus(doc,'OCR unavailable — please enter values manually.');continue;}
        try {
          if(!worker)worker=await window.Tesseract.createWorker('eng');
          setDocumentStatus(doc,'Reading document…');
          const result=await worker.recognize(doc.dataUrl);
          doc.ocrText=result.data.text;
          const extracted=parseDocument(doc.ocrText);
          for(const [key,val] of Object.entries(extracted))if(val!=='' && entry[key]==='')entry[key]=val;
          setDocumentStatus(doc,'OCR completed · verify all values');renderEntries();
        }catch(err){console.error(err);setDocumentStatus(doc,'OCR failed · enter details manually');}
      }
    } finally {if(worker)await worker.terminate();state.scanning=false; if(state.queue.length)void pumpOCR();}
  }
  function dateForExcel(value) {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
    const [y,m,d]=value.split('-').map(Number);const dt=new Date(Date.UTC(y,m-1,d));
    return dt.getUTCDate()===d&&dt.getUTCMonth()===m-1?dt:null;
  }
  function dateLabel(value) {if(!value)return '';const parts=value.split('-');return `${parts[1]}/${parts[2]}/${parts[0]}`;}
  function reportPeriod({from,to}) {return from && to ? `${dateLabel(from)} - ${dateLabel(to)}` : (from?`FROM ${dateLabel(from)}`:(to?`UNTIL ${dateLabel(to)}`:''));}
  function setCellBorder(cell, color='222F30') {const argb=color.length===6?`FF${color}`:color;cell.border={top:{style:'thin',color:{argb}},left:{style:'thin',color:{argb}},bottom:{style:'thin',color:{argb}},right:{style:'thin',color:{argb}}};}
  const THEME={dark:'FF3E8E5A',mid:'FF6FBF8B',soft:'FFA8D5B5',light:'FFE8F5EC',band:'FFF5FBF7',white:'FFFFFFFF',line:'FFB7D3BF',headLine:'FF2F7347'};
  const solid=argb=>({type:'pattern',pattern:'solid',fgColor:{argb}});
  const FOOTER='&L&"Arial,Regular"&8Bacolod Warehouse – Petty Cash Liquidation&C&"Arial,Regular"&8Printed &D&R&"Arial,Regular"&8Page &P of &N';
  async function exportExcel() {
    if(!window.ExcelJS){toast('Excel writer could not load. Check your internet connection.',true);return;}
    if(!state.entries.length){toast('Add at least one liquidation entry first.',true);return;}
    const btn=$('downloadXlsx');btn.disabled=true;btn.innerHTML='Preparing workbook…';
    try {
      const info=details();const wb=new window.ExcelJS.Workbook();wb.creator='Bacolod Warehouse Petty Cash Studio';wb.created=new Date();wb.calcProperties.fullCalcOnLoad=true;
      const sheetTitle=('REF#'+(info.reference||'NEW')).replace(/[\[\]:*?/\\]/g,'').slice(0,31);
      const margins={left:0.22,right:0.22,top:0.3,bottom:0.4,header:0.12,footer:0.18};
      const ws=wb.addWorksheet(sheetTitle,{
        pageSetup:{paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:1,horizontalCentered:true,margins,printTitlesRow:'5:6'},
        headerFooter:{oddFooter:FOOTER},
        views:[{state:'frozen',ySplit:6,showGridLines:false}]
      });
      ws.columns=[{width:12},{width:15},{width:30},{width:20},{width:15},{width:19},{width:18},{width:19},{width:2},{width:46}];
      // Header band
      ws.mergeCells('A1:J1');ws.getCell('A1').value='BACOLOD WAREHOUSE';
      ws.mergeCells('A2:J2');ws.getCell('A2').value='PETTY CASH LIQUIDATION';
      ws.getRow(1).height=26;ws.getRow(2).height=23;
      for(const [row,fontSize,fill] of [[1,18,THEME.dark],[2,12,THEME.mid]]){
        for(let c=1;c<=10;c++)ws.getCell(row,c).fill=solid(fill);
        const cell=ws.getCell(`A${row}`);
        cell.font={name:'Arial',size:fontSize,bold:true,color:{argb:THEME.white}};cell.alignment={horizontal:'center',vertical:'middle'};
      }
      // Reference / period
      ws.mergeCells('A3:C3');ws.getCell('A3').value=`REF# : ${info.reference}`;
      ws.mergeCells('D3:H3');ws.getCell('D3').value=reportPeriod(info);
      ws.getCell('A3').font={name:'Arial',size:11,bold:true,color:{argb:THEME.headLine}};ws.getCell('A3').alignment={horizontal:'left',vertical:'middle',indent:1};
      ws.getCell('D3').font={name:'Arial',size:11,bold:true,color:{argb:THEME.headLine}};ws.getCell('D3').alignment={horizontal:'right',vertical:'middle'};
      ws.getRow(3).height=22;
      ws.mergeCells('A4:J4');ws.getCell('A4').fill=solid(THEME.soft);ws.getRow(4).height=5;
      // Column headings
      [['A','DATE'],['B','PAYEE'],['C','COMPANY NAME'],['D','TIN'],['E','OR.#/S.I.#'],['J','PARTICULARS']].forEach(([col,label])=>{ws.mergeCells(`${col}5:${col}6`);ws.getCell(`${col}5`).value=label;});
      ws.getCell('F5').value='TOTAL';ws.getCell('F6').value='AMOUNT';ws.getCell('G5').value='12%';ws.getCell('G6').value='VAT';ws.getCell('H5').value='AMOUNT';ws.getCell('H6').value='W/O VAT';
      ws.getRow(5).height=18;ws.getRow(6).height=18;
      for(let r=5;r<=6;r++)for(let c=1;c<=10;c++){
        if(c===9)continue;
        const cell=ws.getCell(r,c);cell.fill=solid(THEME.dark);
        cell.font={name:'Arial',size:9,bold:true,color:{argb:THEME.white}};
        cell.alignment={horizontal:'center',vertical:'middle',wrapText:true};setCellBorder(cell,'2F7347');
      }
      // Data rows
      // 13 transaction rows by default, starting directly below the row 5–6 headers.
      const count=Math.max(13,state.entries.length);const first=7;const last=first+count-1;const totalRow=last+1;
      state.entries.forEach((entry,i)=>{
        const row=ws.getRow(first+i);row.height=22;
        const fields=[dateForExcel(entry.date),compact(entry.payee).toUpperCase()||null,compact(entry.company).toUpperCase()||null,compact(entry.tin)||null,compact(entry.receipt)||null,number(entry.amount),number(entry.vat),number(entry.net),null,compact(entry.particulars).toUpperCase()||null];
        fields.forEach((v,j)=>{if(v!==null && v!==undefined)row.getCell(j+1).value=v;});
        row.getCell(1).numFmt='mm/dd/yyyy';
        for(const col of [6,7,8])row.getCell(col).numFmt='#,##0.00;[Red](#,##0.00);-';
      });
      for(let r=first;r<=last;r++){
        const row=ws.getRow(r);row.height=22;
        for(let c=1;c<=10;c++){
          const cell=row.getCell(c);cell.font={name:'Arial',size:9,color:{argb:'FF1F2D26'}};
          cell.alignment={vertical:'middle',horizontal:[6,7,8].includes(c)?'right':c===10?'left':'center',wrapText:false,indent:0,shrinkToFit:true};
          if(c!==9){const line={style:'hair',color:{argb:'FFE2EAE4'}};cell.border={top:line,bottom:line,left:line,right:line};}
          if(r%2===0&&c!==9)cell.fill=solid(THEME.band);
        }
      }
      // Totals
      ws.mergeCells(`A${totalRow}:E${totalRow}`);
      ws.getCell(`A${totalRow}`).value='TOTAL';
      ws.getCell(`A${totalRow}`).font={name:'Arial',size:11,bold:true,color:{argb:THEME.headLine}};
      ws.getCell(`A${totalRow}`).alignment={horizontal:'right',vertical:'middle',indent:1};
      for(let c=1;c<=8;c++){const cell=ws.getCell(totalRow,c);cell.fill=solid(THEME.light);setCellBorder(cell,'2F7347');}
      for(const col of ['F','G','H']){
        const field={F:'amount',G:'vat',H:'net'}[col];
        const cell=ws.getCell(`${col}${totalRow}`);cell.value={formula:`SUM(${col}${first}:${col}${last})`,result:state.entries.reduce((sum,e)=>sum+safeNum(e[field]),0)};
        cell.numFmt='#,##0.00;[Red](#,##0.00);-';cell.font={name:'Arial',size:11,bold:true,color:{argb:col==='F'?'FFC52F2F':'FF1F4D33'}};
        cell.alignment={horizontal:'right',vertical:'middle',shrinkToFit:true};
      }
      ws.getRow(totalRow).height=23;
      // Signatures
      const prep=ws.getCell(`C${totalRow+2}`);
      prep.value=`PREPARED BY: ${info.preparedBy||''}`;prep.font={name:'Arial',size:10,bold:true,color:{argb:'FF1F4D33'}};
      const approvers=info.approvers.split(',').map(s=>s.trim()).filter(Boolean);
      ws.getRow(totalRow+5).height=20;
      const signBorder={top:{style:'thin',color:{argb:'FF222F30'}}};
      const names=[[`C${totalRow+6}`,approvers[0]||null,`C${totalRow+7}`,'SENIOR TEAM LEADER'],[`D${totalRow+6}`,approvers[1]||null,`D${totalRow+7}`,'AREA MANAGER']];
      for(const [nameCell,name,titleCell,title] of names){
        const n=ws.getCell(nameCell);n.value=name;n.font={name:'Arial',size:9,bold:true};n.alignment={horizontal:'center',vertical:'middle',wrapText:true};n.border=signBorder;
        const t=ws.getCell(titleCell);t.value=title;t.font={name:'Arial',size:8,italic:true,color:{argb:'FF55675D'}};t.alignment={horizontal:'center',vertical:'middle'};
      }
      ws.printArea=`A1:J${totalRow+8}`;
      // Attachments sheet
      const support=wb.addWorksheet('ATTACHMENTS',{
        pageSetup:{paperSize:9,orientation:'portrait',fitToPage:true,fitToWidth:1,fitToHeight:0,horizontalCentered:true,margins},
        headerFooter:{oddFooter:FOOTER},
        views:[{showGridLines:false}]
      });
      for(let i=1;i<=22;i++)support.getColumn(i).width=10;
      support.mergeCells('A1:V2');support.getCell('A1').value=`SUPPORTING DOCUMENTS — REF# ${info.reference}`;
      support.getCell('A1').fill=solid(THEME.dark);
      support.getCell('A1').font={name:'Arial',bold:true,size:16,color:{argb:THEME.white}};support.getCell('A1').alignment={vertical:'middle',horizontal:'center'};
      support.getRow(1).height=25;support.getRow(2).height=16;
      const attached=state.documents.filter(d=>d.attachment);let nextRow=5;
      if(!attached.length){support.getCell('A5').value='NO SUPPORTING DOCUMENTS ATTACHED';support.getCell('A5').font={name:'Arial',italic:true,color:{argb:'FF71858A'}};}
      for(let idx=0;idx<attached.length;idx++){
        const doc=attached[idx];
        support.mergeCells(`A${nextRow}:V${nextRow}`);
        const label=support.getCell(`A${nextRow}`);label.value=`${idx+1}. ${doc.name}`;
        label.font={name:'Arial',size:10,bold:true,color:{argb:'FF1F4D33'}};label.fill=solid(THEME.light);label.alignment={vertical:'middle',indent:1};
        support.getRow(nextRow).height=20;
        const imgId=wb.addImage({base64:doc.dataUrl,extension:'png'});
        const maxWidth=790;const width=Math.min(maxWidth,doc.width);const height=width*doc.height/doc.width;
        support.addImage(imgId,{tl:{col:0,row:nextRow+1},ext:{width,height}});
        nextRow+=Math.ceil(height/20)+5;
      }
      support.printArea=`A1:V${Math.max(nextRow,8)}`;
      const out=await wb.xlsx.writeBuffer();
      const blob=new Blob([out],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
      const href=URL.createObjectURL(blob);const a=document.createElement('a');a.href=href;
      a.download=`Petty-Cash-REF-${(info.reference||'NEW').replace(/[^a-zA-Z0-9-]/g,'-')}.xlsx`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(href),30000);
      toast('Excel report created. Check both sheets and all totals before submission.');
    }catch(err){console.error(err);toast(`Could not create report: ${err.message}`,true);}
    finally{btn.disabled=false;btn.innerHTML='Generate Excel <span>↗</span>';}
  }
  function downloadDraft() {
    const content=JSON.stringify({version:1,details:details(),documents:state.documents,entries:state.entries},null,2);
    const a=document.createElement('a');const href=URL.createObjectURL(new Blob([content],{type:'application/json'}));
    a.href=href;a.download=`Petty-Cash-Draft-${Date.now()}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(href),10000);
    toast('Draft downloaded to your computer. Keep it private.');
  }
  async function loadDraft(file) {
    try {
      const parsed=JSON.parse(await file.text());
      if(parsed.version!==1||!Array.isArray(parsed.documents)||!Array.isArray(parsed.entries))throw new Error('Not a Petty Cash Studio draft');
      if(!confirm('Replace this session with the selected saved draft?'))return;
      state.documents=parsed.documents.filter(d=>d&&typeof d.dataUrl==='string'&&/^data:image\/(png|jpeg|webp);base64,/.test(d.dataUrl));
      state.entries=parsed.entries.filter(e=>e&&e.id).map(e=>({...blankEntry(),...e}));state.queue=[];
      const ids={reference:'reference',from:'periodFrom',to:'periodTo',preparedBy:'preparedBy',defaultPayee:'defaultPayee',approvers:'approvers'};
      for(const [key,id] of Object.entries(ids))$(id).value=parsed.details?.[key]||'';
      renderDocuments();renderEntries();toast('Draft restored. Review data before export.');
    }catch(err){toast(`Invalid draft: ${err.message}`,true);}
  }
  function setupCrop(doc) {
    state.cropping={doc,rect:null,down:null};$('cropModal').hidden=false;$('cropAccept').disabled=true;
    const im=new Image();im.onload=()=>{
      const canvas=$('cropCanvas');canvas.width=Math.min(850,im.naturalWidth);canvas.height=Math.round(canvas.width*im.naturalHeight/im.naturalWidth);
      state.cropping.image=im;drawCrop();
    };im.src=doc.dataUrl;
  }
  function drawCrop() {
    const c=$('cropCanvas'),ctx=c.getContext('2d'),crop=state.cropping;if(!crop?.image)return;
    ctx.clearRect(0,0,c.width,c.height);ctx.drawImage(crop.image,0,0,c.width,c.height);
    if(crop.rect){const {x,y,w,h}=crop.rect;ctx.fillStyle='rgba(25,60,60,.12)';ctx.fillRect(x,y,w,h);ctx.lineWidth=3;ctx.strokeStyle='#d4ec75';ctx.strokeRect(x,y,w,h);}
  }
  function canvasPoint(evt) {const rect=$('cropCanvas').getBoundingClientRect();return{x:(evt.clientX-rect.left)*$('cropCanvas').width/rect.width,y:(evt.clientY-rect.top)*$('cropCanvas').height/rect.height};}
  function cropMove(event) {
    const crop=state.cropping;if(!crop?.down)return;
    const p=canvasPoint(event);const x=Math.max(0,Math.min(crop.down.x,p.x)),y=Math.max(0,Math.min(crop.down.y,p.y));
    crop.rect={x,y,w:Math.abs(crop.down.x-p.x),h:Math.abs(crop.down.y-p.y)};drawCrop();
  }
  async function acceptCrop() {
    const crop=state.cropping;if(!crop?.rect)return;
    const {x,y,w,h}=crop.rect;if(w<20||h<20){toast('Choose a larger area.',true);return;}
    const factor=crop.image.naturalWidth/$('cropCanvas').width;
    const c=document.createElement('canvas');c.width=Math.round(w*factor);c.height=Math.round(h*factor);
    c.getContext('2d').drawImage(crop.image,x*factor,y*factor,w*factor,h*factor,0,0,c.width,c.height);
    const name=`${crop.doc.name} · cropped receipt`;
    $('cropModal').hidden=true;state.cropping=null;
    await addDocument(c.toDataURL('image/png'),name,false,true);
    toast('Cropped receipt added as a separate entry.');
  }
  function init() {
    const input=$('fileInput'),zone=$('dropzone');
    zone.addEventListener('click',()=>input.click());zone.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();input.click();}});
    zone.addEventListener('dragover',e=>{e.preventDefault();zone.classList.add('dragging');});
    zone.addEventListener('dragleave',()=>zone.classList.remove('dragging'));
    zone.addEventListener('drop',e=>{e.preventDefault();zone.classList.remove('dragging');void handleFiles([...e.dataTransfer.files]);});
    input.addEventListener('change',()=>{void handleFiles([...input.files]);input.value='';});
    $('addEntry').addEventListener('click',()=>{state.entries.push(blankEntry());renderEntries();});
    $('addManual').addEventListener('click',()=>{state.entries.push(blankEntry());renderEntries();$('entries').scrollIntoView({behavior:'smooth'});});
    $('entryRows').addEventListener('input',event=>{
      const input=event.target.closest('input[data-field]');if(!input)return;
      const item=state.entries.find(e=>e.id===input.closest('tr').dataset.row);if(!item)return;
      item[input.dataset.field]=input.value;summary();
    });
    $('entryRows').addEventListener('click',event=>{
      const btn=event.target.closest('button[data-action]');if(!btn)return;
      const row=btn.closest('tr'),index=state.entries.findIndex(e=>e.id===row.dataset.row);if(index<0)return;
      if(btn.dataset.action==='remove')state.entries.splice(index,1);
      else if(btn.dataset.action==='duplicate')state.entries.splice(index+1,0,{...state.entries[index],id:newId()});
      renderEntries();
    });
    $('documentList').addEventListener('click',event=>{
      const card=event.target.closest('[data-document]');if(!card)return;
      const doc=state.documents.find(d=>d.id===card.dataset.document);if(!doc)return;
      const btn=event.target.closest('[data-action]');
      if(!btn){window.open(doc.dataUrl,'_blank','noopener,noreferrer');return;}
      if(btn.dataset.action==='add'){state.entries.push(blankEntry(doc.id));renderEntries();toast('Blank entry added for this document.');}
      if(btn.dataset.action==='crop')setupCrop(doc);
      if(btn.dataset.action==='remove'){
        if(state.entries.some(e=>e.sourceId===doc.id)&&!confirm('Remove document? Linked entries will remain, but the source image will be removed.'))return;
        state.documents=state.documents.filter(d=>d.id!==doc.id);state.queue=state.queue.filter(q=>q.docId!==doc.id);renderDocuments();
      }
    });
    $('clearDocs').addEventListener('click',()=>{if(!state.documents.length)return;
      if(!confirm('Remove all supporting documents? Your liquidation entries will remain.'))return;
      state.documents=[];state.queue=[];renderDocuments();
    });
    $('cropCanvas').addEventListener('pointerdown',e=>{if(!state.cropping)return;$('cropCanvas').setPointerCapture(e.pointerId);state.cropping.down=canvasPoint(e);state.cropping.rect=null;});
    $('cropCanvas').addEventListener('pointermove',cropMove);
    $('cropCanvas').addEventListener('pointerup',e=>{cropMove(e);if(state.cropping)state.cropping.down=null;$('cropAccept').disabled=!state.cropping?.rect||state.cropping.rect.w<20||state.cropping.rect.h<20;});
    $('closeCrop').addEventListener('click',()=>{$('cropModal').hidden=true;state.cropping=null;});
    $('cropModal').addEventListener('click',e=>{if(e.target===$('cropModal')){$('cropModal').hidden=true;state.cropping=null;}});
    $('cropAccept').addEventListener('click',()=>void acceptCrop());
    $('downloadXlsx').addEventListener('click',()=>void exportExcel());
    $('saveDraft').addEventListener('click',downloadDraft);
    $('loadDraft').addEventListener('click',()=>$('draftInput').click());
    $('draftInput').addEventListener('change',()=>{if($('draftInput').files?.[0])void loadDraft($('draftInput').files[0]);$('draftInput').value='';});
    $('periodFrom').value='';$('periodTo').value='';
    document.querySelectorAll('.steps a').forEach(a=>a.addEventListener('click',()=>{document.querySelectorAll('.steps a').forEach(e=>e.classList.remove('active'));a.classList.add('active');}));
    renderDocuments();renderEntries();
  }
  init();
  // Expose pure parsing helpers for automated smoke tests, never document data.
  window.PettyCashTest={parseDocument,parseDate,reportPeriod};
})();