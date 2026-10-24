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
  const LOGO_DATA_URL='data:image/png;base64,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';
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
      const margins={left:0.4,right:0.4,top:0.5,bottom:0.7,header:0.3,footer:0.3};
      const ws=wb.addWorksheet(sheetTitle,{
        pageSetup:{paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,horizontalCentered:true,margins,printTitlesRow:'5:6'},
        headerFooter:{oddFooter:FOOTER},
        views:[{state:'frozen',ySplit:6,showGridLines:false}]
      });
      ws.columns=[{width:12},{width:15},{width:30},{width:20},{width:15},{width:14},{width:12},{width:14},{width:2},{width:46}];
      // Header band with logo
      for(let r=1;r<=2;r++)for(let c=1;c<=3;c++){const lc=ws.getCell(r,c);lc.value=null;lc.fill=solid(THEME.white);}
      ws.mergeCells('D1:J1');ws.getCell('D1').value='BACOLOD WAREHOUSE';
      ws.mergeCells('D2:J2');ws.getCell('D2').value='PETTY CASH LIQUIDATION';
      ws.getRow(1).height=32;ws.getRow(2).height=28;
      for(const [row,fontSize,fill] of [[1,18,THEME.dark],[2,12,THEME.mid]]){
        for(let c=4;c<=10;c++)ws.getCell(row,c).fill=solid(fill);
        const cell=ws.getCell(`D${row}`);
        cell.font={name:'Arial',size:fontSize,bold:true,color:{argb:THEME.white}};cell.alignment={horizontal:'center',vertical:'middle'};
      }
      try{
        const logoId=wb.addImage({base64:LOGO_DATA_URL,extension:'png'});
        ws.addImage(logoId,{tl:{col:0.1,row:0.2},ext:{width:230,height:60}});
      }catch(e){console.warn('Logo could not be added',e);}
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
      const count=Math.max(13,state.entries.length);const first=7;const last=first+count-1;const totalRow=last+1;
      state.entries.forEach((entry,i)=>{
        const row=ws.getRow(first+i);row.height=29;
        const fields=[dateForExcel(entry.date),compact(entry.payee).toUpperCase()||null,compact(entry.company).toUpperCase()||null,compact(entry.tin)||null,compact(entry.receipt)||null,number(entry.amount),number(entry.vat),number(entry.net),null,compact(entry.particulars).toUpperCase()||null];
        fields.forEach((v,j)=>{if(v!==null && v!==undefined)row.getCell(j+1).value=v;});
        row.getCell(1).numFmt='mm/dd/yyyy';
        for(const col of [6,7,8])row.getCell(col).numFmt='#,##0.00;[Red](#,##0.00);-';
      });
      for(let r=first;r<=last;r++){
        const row=ws.getRow(r);if(!row.height)row.height=24;
        for(let c=1;c<=10;c++){
          const cell=row.getCell(c);cell.font={name:'Arial',size:9,color:{argb:'FF1F2D26'}};
          cell.alignment={vertical:'middle',horizontal:[6,7,8].includes(c)?'right':c===10?'left':'center',wrapText:true,indent:[6,7,8].includes(c)||c===10?1:0};
          if(c!==9)setCellBorder(cell,'B7D3BF');
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
        cell.alignment={horizontal:'right',vertical:'middle',indent:1};
      }
      ws.getRow(totalRow).height=26;
      // Signatures
      const prep=ws.getCell(`C${totalRow+2}`);
      prep.value=`PREPARED BY: ${info.preparedBy||''}`;prep.font={name:'Arial',size:10,bold:true,color:{argb:'FF1F4D33'}};
      const approvers=info.approvers.split(',').map(s=>s.trim()).filter(Boolean);
      ws.getRow(totalRow+5).height=26;
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
