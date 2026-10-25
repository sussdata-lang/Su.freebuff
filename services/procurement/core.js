// المشتريات والمخازن والأصول — النواة
import { tx } from '../../db.js';
import { audit } from '../../audit.js';
import { HttpError } from '../../http.js';
export const bad = (m, s=400, code='validation') => new HttpError(s, m, code);
const clean = (s, max, label, min=1) => {
  const v = String(s??'').replace(/\s+/g,' ').trim();
  if(v.length < min || v.length > max) throw bad(`«${label}» بين ${min} و${max} حرفاً.`);
  if(/[\x00-\x1f<>]/.test(v)) throw bad(`«${label}» يحوي رموزاً غير مسموحة.`);
  return v;
};
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const isDay = (s) => DAY.test(String(s)) && !isNaN(Date.parse(s+'T00:00:00Z')) && new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
export const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Damascus'}).format(new Date());
export { clean };
const nextNo = (db, prefix, table) => {
  const y = today().slice(0,4);
  const like = `${prefix}-${y}-%`;
  const row = db.prepare(`SELECT no FROM ${table} WHERE no LIKE ? ORDER BY id DESC LIMIT 1`).get(like);
  let n = 1;
  if(row?.no){ const m = /-(\d+)$/.exec(row.no); if(m) n = Number(m[1])+1; }
  return `${prefix}-${y}-${String(n).padStart(5,'0')}`;
};
/* Warehouses */
export function listWarehouses(db){ return db.prepare('SELECT w.*, u.display_name manager_name FROM proc_warehouses w LEFT JOIN users u ON u.id=w.manager_id ORDER BY w.code').all().map(r=>({id:r.id,code:r.code,name:r.name,location:r.location,managerId:r.manager_id,managerName:r.manager_name,active:!!r.active,createdAt:r.created_at})); }
export function createWarehouse({db},actor,b,ip){
  const code=clean(b?.code,20,'رمز المخزن'); if(!/^[A-Z0-9.-]+$/i.test(code)) throw bad('رمز المخزن: حروف وأرقام و . - فقط.');
  const name=clean(b?.name,80,'اسم المخزن',2);
  if(db.prepare('SELECT 1 FROM proc_warehouses WHERE code=?').get(code)) throw bad('رمز المخزن مستخدم.',409,'conflict');
  const loc = String(b?.location??'').slice(0,120);
  const mid = b?.managerId ? Number(b.managerId) : null;
  if(mid && !db.prepare('SELECT 1 FROM users WHERE id=?').get(mid)) throw bad('مسؤول المخزن غير موجود.');
  const id=Number(db.prepare('INSERT INTO proc_warehouses (code,name,location,manager_id,created_at) VALUES (?,?,?,?,?)').run(code,name,loc,mid,Date.now()).lastInsertRowid);
  audit(db,actor,'إضافة مخزن',code,ip); return {warehouse: db.prepare('SELECT * FROM proc_warehouses WHERE id=?').get(id)};
}
export function updateWarehouse({db},actor,id,b,ip){
  const cur=db.prepare('SELECT * FROM proc_warehouses WHERE id=?').get(Number(id)); if(!cur) throw bad('المخزن غير موجود.',404,'not_found');
  const code=b?.code?clean(b.code,20,'رمز المخزن'):cur.code; const name=b?.name?clean(b.name,80,'اسم المخزن',2):cur.name;
  if(code!==cur.code && db.prepare('SELECT 1 FROM proc_warehouses WHERE code=? AND id!=?').get(code,cur.id)) throw bad('رمز المخزن مستخدم.',409,'conflict');
  const loc = b?.location!==undefined?String(b.location).slice(0,120):cur.location;
  const mid = b?.managerId!==undefined?(b.managerId?Number(b.managerId):null):cur.manager_id;
  db.prepare('UPDATE proc_warehouses SET code=?,name=?,location=?,manager_id=? WHERE id=?').run(code,name,loc,mid,cur.id);
  audit(db,actor,'تعديل مخزن',code,ip); return {warehouse: db.prepare('SELECT * FROM proc_warehouses WHERE id=?').get(cur.id)};
}
export function toggleWarehouse({db},actor,id,on,ip){
  const r=db.prepare('UPDATE proc_warehouses SET active=? WHERE id=?').run(on?1:0,Number(id)); if(!r.changes) throw bad('المخزن غير موجود.',404,'not_found');
  audit(db,actor,on?'تفعيل مخزن':'تعطيل مخزن',String(id),ip); return {ok:true};
}
export function deleteWarehouse({db},actor,id,ip){
  const cur=db.prepare('SELECT * FROM proc_warehouses WHERE id=?').get(Number(id)); if(!cur) throw bad('المخزن غير موجود.',404,'not_found');
  if(db.prepare('SELECT 1 FROM proc_items WHERE warehouse_id=? LIMIT 1').get(cur.id)) throw bad('المخزن مرتبط بأصناف فلا يُحذف؛ عطّله.',409,'conflict');
  if(db.prepare('SELECT 1 FROM proc_requests WHERE warehouse_id=? LIMIT 1').get(cur.id)) throw bad('المخزن مرتبط بطلبات فلا يُحذف.',409,'conflict');
  db.prepare('DELETE FROM proc_warehouses WHERE id=?').run(cur.id); audit(db,actor,'حذف مخزن',cur.code,ip); return {ok:true};
}
/* Suppliers */
export function listSuppliers(db,q={}){
  const w=[],a=[]; if(q.q){ const l='%'+String(q.q).replace(/[\\%_]/g,'\\$&')+'%'; w.push('(name LIKE ? ESCAPE "\\" OR code LIKE ? ESCAPE "\\")'); a.push(l,l); }
  const where=w.length?'WHERE '+w.join(' AND '):'';
  return db.prepare(`SELECT * FROM proc_suppliers ${where} ORDER BY name LIMIT 200`).all(...a).map(r=>({id:r.id,code:r.code,name:r.name,phone:r.phone,email:r.email,address:r.address,taxNo:r.tax_no,active:!!r.active,createdAt:r.created_at}));
}
export function createSupplier({db},actor,b,ip){
  const code=clean(b?.code,20,'رمز المورد'); const name=clean(b?.name,80,'اسم المورد',2);
  if(db.prepare('SELECT 1 FROM proc_suppliers WHERE code=?').get(code)) throw bad('رمز المورد مستخدم.',409,'conflict');
  const id=Number(db.prepare('INSERT INTO proc_suppliers (code,name,phone,email,address,tax_no,created_at) VALUES (?,?,?,?,?,?,?)').run(code,name,b?.phone??null,b?.email??null,b?.address??null,b?.taxNo??null,Date.now()).lastInsertRowid);
  audit(db,actor,'إضافة مورد',code,ip); return {supplier: db.prepare('SELECT * FROM proc_suppliers WHERE id=?').get(id)};
}
export function updateSupplier({db},actor,id,b,ip){
  const cur=db.prepare('SELECT * FROM proc_suppliers WHERE id=?').get(Number(id)); if(!cur) throw bad('المورد غير موجود.',404,'not_found');
  const code=b?.code?clean(b.code,20,'رمز المورد'):cur.code; const name=b?.name?clean(b.name,80,'اسم المورد',2):cur.name;
  if(code!==cur.code && db.prepare('SELECT 1 FROM proc_suppliers WHERE code=? AND id!=?').get(code,cur.id)) throw bad('رمز المورد مستخدم.',409,'conflict');
  db.prepare('UPDATE proc_suppliers SET code=?,name=?,phone=?,email=?,address=?,tax_no=? WHERE id=?').run(code,name,b?.phone??cur.phone,b?.email??cur.email,b?.address??cur.address,b?.taxNo??cur.tax_no,cur.id);
  audit(db,actor,'تعديل مورد',code,ip); return {supplier: db.prepare('SELECT * FROM proc_suppliers WHERE id=?').get(cur.id)};
}
export function toggleSupplier({db},actor,id,on,ip){
  const r=db.prepare('UPDATE proc_suppliers SET active=? WHERE id=?').run(on?1:0,Number(id)); if(!r.changes) throw bad('المورد غير موجود.',404,'not_found');
  audit(db,actor,on?'تفعيل مورد':'تعطيل مورد',String(id),ip); return {ok:true};
}
export function deleteSupplier({db},actor,id,ip){
  const cur=db.prepare('SELECT * FROM proc_suppliers WHERE id=?').get(Number(id)); if(!cur) throw bad('المورد غير موجود.',404,'not_found');
  if(db.prepare('SELECT 1 FROM proc_orders WHERE supplier_id=? LIMIT 1').get(cur.id)) throw bad('المورد مرتبط بأوامر توريد فلا يُحذف؛ عطّله.',409,'conflict');
  db.prepare('DELETE FROM proc_suppliers WHERE id=?').run(cur.id); audit(db,actor,'حذف مورد',cur.code,ip); return {ok:true};
}
/* Categories */
export function listCategories(db){ return db.prepare('SELECT * FROM proc_categories ORDER BY code').all().map(r=>({id:r.id,code:r.code,name:r.name,active:!!r.active})); }
/* Items */
export function listItems(db,q={}){
  const w=[],a=[];
  if(q.q){ const l='%'+String(q.q).replace(/[\\%_]/g,'\\$&')+'%'; w.push('(i.name LIKE ? ESCAPE "\\" OR i.code LIKE ? ESCAPE "\\")'); a.push(l,l); }
  if(q.warehouse) { w.push('i.warehouse_id=?'); a.push(Number(q.warehouse)); }
  if(q.category) { w.push('i.category_id=?'); a.push(Number(q.category)); }
  if(q.low==='1') w.push('i.qty_on_hand <= i.min_stock AND i.min_stock > 0');
  const where=w.length?'WHERE '+w.join(' AND '):'';
  return db.prepare(`SELECT i.*, c.name catName, w.name whName FROM proc_items i LEFT JOIN proc_categories c ON c.id=i.category_id LEFT JOIN proc_warehouses w ON w.id=i.warehouse_id ${where} ORDER BY i.code LIMIT 500`).all(...a).map(r=>({id:r.id,code:r.code,name:r.name,categoryId:r.category_id,categoryName:r.catName,unit:r.unit,warehouseId:r.warehouse_id,warehouseName:r.whName,qtyOnHand:r.qty_on_hand,avgCost:r.avg_cost,minStock:r.min_stock,maxStock:r.max_stock,active:!!r.active,notes:r.notes,low: r.min_stock>0 && r.qty_on_hand<=r.min_stock}));
}
export function createItem({db},actor,b,ip){
  const code=clean(b?.code,20,'رمز الصنف'); const name=clean(b?.name,80,'اسم الصنف',2);
  if(db.prepare('SELECT 1 FROM proc_items WHERE code=?').get(code)) throw bad('رمز الصنف مستخدم.',409,'conflict');
  const catId=b?.categoryId?Number(b.categoryId):null; if(catId && !db.prepare('SELECT 1 FROM proc_categories WHERE id=?').get(catId)) throw bad('التصنيف غير موجود.');
  const whId=b?.warehouseId?Number(b.warehouseId):null; if(whId && !db.prepare('SELECT 1 FROM proc_warehouses WHERE id=? AND active=1').get(whId)) throw bad('المخزن غير موجود أو معطّل.');
  const unit=clean(b?.unit??'قطعة',20,'الوحدة'); const minS=Number(b?.minStock??0), maxS=Number(b?.maxStock??0);
  const id=Number(db.prepare('INSERT INTO proc_items (code,name,category_id,unit,warehouse_id,min_stock,max_stock,notes,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(code,name,catId,unit,whId,minS,maxS,String(b?.notes??'').slice(0,300),Date.now()).lastInsertRowid);
  audit(db,actor,'إضافة صنف',code,ip); return {item: db.prepare('SELECT * FROM proc_items WHERE id=?').get(id)};
}
export function updateItem({db},actor,id,b,ip){
  const cur=db.prepare('SELECT * FROM proc_items WHERE id=?').get(Number(id)); if(!cur) throw bad('الصنف غير موجود.',404,'not_found');
  const code=b?.code?clean(b.code,20,'رمز الصنف'):cur.code; const name=b?.name?clean(b.name,80,'اسم الصنف',2):cur.name;
  if(code!==cur.code && db.prepare('SELECT 1 FROM proc_items WHERE code=? AND id!=?').get(code,cur.id)) throw bad('رمز الصنف مستخدم.',409,'conflict');
  const catId=b?.categoryId!==undefined?(b.categoryId?Number(b.categoryId):null):cur.category_id;
  const whId=b?.warehouseId!==undefined?(b.warehouseId?Number(b.warehouseId):null):cur.warehouse_id;
  const unit=b?.unit?clean(b.unit,20,'الوحدة'):cur.unit;
  const minS=b?.minStock!==undefined?Number(b.minStock):cur.min_stock; const maxS=b?.maxStock!==undefined?Number(b.maxStock):cur.max_stock;
  db.prepare('UPDATE proc_items SET code=?,name=?,category_id=?,unit=?,warehouse_id=?,min_stock=?,max_stock=?,notes=? WHERE id=?').run(code,name,catId,unit,whId,minS,maxS, b?.notes!==undefined?String(b.notes).slice(0,300):cur.notes, cur.id);
  audit(db,actor,'تعديل صنف',code,ip); return {item: db.prepare('SELECT * FROM proc_items WHERE id=?').get(cur.id)};
}
export function toggleItem({db},actor,id,on,ip){
  const r=db.prepare('UPDATE proc_items SET active=? WHERE id=?').run(on?1:0,Number(id)); if(!r.changes) throw bad('الصنف غير موجود.',404,'not_found');
  audit(db,actor,on?'تفعيل صنف':'تعطيل صنف',String(id),ip); return {ok:true};
}
export function deleteItem({db},actor,id,ip){
  const cur=db.prepare('SELECT * FROM proc_items WHERE id=?').get(Number(id)); if(!cur) throw bad('الصنف غير موجود.',404,'not_found');
  if(cur.qty_on_hand>0) throw bad('الصنف به رصيد فلا يُحذف.',409,'conflict');
  if(db.prepare('SELECT 1 FROM proc_request_lines WHERE item_id=? LIMIT 1').get(cur.id) || db.prepare('SELECT 1 FROM proc_order_lines WHERE item_id=? LIMIT 1').get(cur.id)) throw bad('الصنف مستخدم في طلبات أو أوامر فلا يُحذف.',409,'conflict');
  db.prepare('DELETE FROM proc_items WHERE id=?').run(cur.id); audit(db,actor,'حذف صنف',cur.code,ip); return {ok:true};
}
/* Requests */
export function listRequests(db,q={}){
  const w=[],a=[]; if(q.status) { w.push('r.status=?'); a.push(q.status); } if(q.q){ const l='%'+String(q.q).replace(/[\\%_]/g,'\\$&')+'%'; w.push('(r.no LIKE ? ESCAPE "\\" OR r.title LIKE ? ESCAPE "\\")'); a.push(l,l); }
  if(q.mine) { w.push('r.requester_id=?'); a.push(Number(q.mine)); }
  const where=w.length?'WHERE '+w.join(' AND '):'';
  return db.prepare(`SELECT r.*, u.display_name requester_name FROM proc_requests r LEFT JOIN users u ON u.id=r.requester_id ${where} ORDER BY r.id DESC LIMIT 300`).all(...a).map(r=>({id:r.id,no:r.no,title:r.title,description:r.description,requesterId:r.requester_id,requesterName:r.requester_name,warehouseId:r.warehouse_id,status:r.status,requestedAt:r.requested_at,decidedBy:r.decided_by,decidedAt:r.decided_at,decisionNote:r.decision_note,createdAt:r.created_at,lines: db.prepare('SELECT l.*, i.name itemName, i.code itemCode FROM proc_request_lines l LEFT JOIN proc_items i ON i.id=l.item_id WHERE l.request_id=? ORDER BY l.id').all(r.id).map(x=>({id:x.id,itemId:x.item_id,itemCode:x.itemCode,itemName:x.itemName,description:x.description,qty:x.qty,estCost:x.est_cost,note:x.note}))}));
}
export function getRequest(db,id){
  const r=db.prepare('SELECT r.*, u.display_name requester_name FROM proc_requests r LEFT JOIN users u ON u.id=r.requester_id WHERE r.id=?').get(Number(id)); if(!r) throw bad('طلب الشراء غير موجود.',404,'not_found');
  const lines=db.prepare('SELECT l.*, i.name itemName, i.code itemCode FROM proc_request_lines l LEFT JOIN proc_items i ON i.id=l.item_id WHERE l.request_id=? ORDER BY l.id').all(r.id);
  return {request:{id:r.id,no:r.no,title:r.title,description:r.description,requesterId:r.requester_id,requesterName:r.requester_name,warehouseId:r.warehouse_id,status:r.status,requestedAt:r.requested_at,decidedBy:r.decided_by,decidedAt:r.decided_at,decisionNote:r.decision_note,createdAt:r.created_at,lines:lines.map(x=>({id:x.id,itemId:x.item_id,itemCode:x.itemCode,itemName:x.itemName,description:x.description,qty:x.qty,estCost:x.est_cost,note:x.note}))}};
}
export function createRequest({db},actor,b,ip){
  const title=clean(b?.title,100,'عنوان الطلب',3); const desc=String(b?.description??'').slice(0,500);
  const whId=b?.warehouseId?Number(b.warehouseId):null; if(whId && !db.prepare('SELECT 1 FROM proc_warehouses WHERE id=?').get(whId)) throw bad('المخزن غير موجود.');
  const lines=b?.lines; if(!Array.isArray(lines)||!lines.length) throw bad('أضف بنداً واحداً على الأقل.');
  if(lines.length>50) throw bad('حتى 50 بنداً للطلب.');
  for(let i=0;i<lines.length;i++){ const l=lines[i]; clean(l?.description,100,`وصف البند ${i+1}`,2); if(Number(l?.qty)<=0) throw bad(`البند ${i+1}: الكمية غير صالحة.`); if(l.itemId && !db.prepare('SELECT 1 FROM proc_items WHERE id=?').get(Number(l.itemId))) throw bad(`البند ${i+1}: الصنف غير موجود.`); }
  return tx(db,()=>{
    const no=nextNo(db,'PRQ','proc_requests');
    const id=Number(db.prepare('INSERT INTO proc_requests (no,title,description,requester_id,warehouse_id,status,created_at) VALUES (?,?,?,?,?,?,?)').run(no,title,desc,actor.id,whId,'draft',Date.now()).lastInsertRowid);
    for(const l of lines) db.prepare('INSERT INTO proc_request_lines (request_id,item_id,description,qty,est_cost,note) VALUES (?,?,?,?,?,?)').run(id, l.itemId?Number(l.itemId):null, clean(l.description,100,'وصف البند',1), Number(l.qty), Number(l.estCost??0), String(l.note??'').slice(0,200));
    if(b?.submit){
      db.prepare("UPDATE proc_requests SET status='pending', requested_at=? WHERE id=?").run(Date.now(),id);
      audit(db,actor,'تقديم طلب شراء',no,ip);
    } else audit(db,actor,'إنشاء طلب شراء',no,ip);
    return getRequest(db,id);
  });
}
export function submitRequest({db},actor,id,ip){
  const r=db.prepare('SELECT * FROM proc_requests WHERE id=?').get(Number(id)); if(!r) throw bad('الطلب غير موجود.',404,'not_found');
  if(r.requester_id!==actor.id && !actor.can('procurement:manage')) throw bad('لا تملك صلاحية إرسال هذا الطلب.',403,'forbidden');
  if(r.status!=='draft') throw bad('الطلب ليس مسودة.',409,'conflict');
  db.prepare("UPDATE proc_requests SET status='pending', requested_at=? WHERE id=?").run(Date.now(),r.id); audit(db,actor,'إرسال طلب شراء',r.no,ip); return getRequest(db,r.id);
}
export function decideRequest({db},actor,id,decision,note,ip){
  const r=db.prepare('SELECT * FROM proc_requests WHERE id=?').get(Number(id)); if(!r) throw bad('الطلب غير موجود.',404,'not_found');
  if(r.status!=='pending') throw bad('الطلب ليس قيد المراجعة.',409,'conflict');
  if(!['approved','rejected'].includes(decision)) throw bad('قرار غير صالح.');
  const n=String(note??'').slice(0,300); if(decision==='rejected' && !n.trim()) throw bad('سبب الرفض مطلوب.');
  db.prepare('UPDATE proc_requests SET status=?, decided_by=?, decided_at=?, decision_note=? WHERE id=?').run(decision,actor.id,Date.now(),n,r.id);
  audit(db,actor,decision==='approved'?'اعتماد طلب شراء':'رفض طلب شراء',r.no,ip); return getRequest(db,r.id);
}
export function cancelRequest({db},actor,id,ip){
  const r=db.prepare('SELECT * FROM proc_requests WHERE id=?').get(Number(id)); if(!r) throw bad('الطلب غير موجود.',404,'not_found');
  if(!['draft','pending'].includes(r.status)) throw bad('لا يمكن إلغاء الطلب في حالته الحالية.',409,'conflict');
  if(r.requester_id!==actor.id && !actor.can('procurement:manage')) throw bad('لا تملك صلاحية الإلغاء.',403,'forbidden');
  db.prepare("UPDATE proc_requests SET status='cancelled' WHERE id=?").run(r.id); audit(db,actor,'إلغاء طلب شراء',r.no,ip); return {ok:true};
}
export function updateRequest({db},actor,id,b,ip){
  const r=db.prepare('SELECT * FROM proc_requests WHERE id=?').get(Number(id)); if(!r) throw bad('الطلب غير موجود.',404,'not_found');
  if(r.status!=='draft') throw bad('لا يمكن تعديل الطلب بعد إرساله.',409,'conflict');
  if(r.requester_id!==actor.id && !actor.can('procurement:manage')) throw bad('لا تملك صلاحية التعديل.',403,'forbidden');
  return tx(db,()=>{
    const title=b?.title?clean(b.title,100,'عنوان الطلب',3):r.title;
    const desc=b?.description!==undefined?String(b.description).slice(0,500):r.description;
    const whId=b?.warehouseId!==undefined?(b.warehouseId?Number(b.warehouseId):null):r.warehouse_id;
    db.prepare('UPDATE proc_requests SET title=?,description=?,warehouse_id=? WHERE id=?').run(title,desc,whId,r.id);
    if(Array.isArray(b?.lines)){
      db.prepare('DELETE FROM proc_request_lines WHERE request_id=?').run(r.id);
      for(const l of b.lines) db.prepare('INSERT INTO proc_request_lines (request_id,item_id,description,qty,est_cost,note) VALUES (?,?,?,?,?,?)').run(r.id,l.itemId?Number(l.itemId):null,clean(l.description,100,'وصف البند',1),Number(l.qty),Number(l.estCost??0),String(l.note??'').slice(0,200));
    }
    if(b?.submit){ db.prepare("UPDATE proc_requests SET status='pending', requested_at=? WHERE id=?").run(Date.now(),r.id); audit(db,actor,'تعديل وإرسال طلب شراء',r.no,ip); } else audit(db,actor,'تعديل طلب شراء',r.no,ip);
    return getRequest(db,r.id);
  });
}
/* Orders */
export function listOrders(db,q={}){
  const w=[],a=[]; if(q.status){w.push('o.status=?');a.push(q.status);} if(q.supplier){w.push('o.supplier_id=?');a.push(Number(q.supplier));}
  const where=w.length?'WHERE '+w.join(' AND '):'';
  return db.prepare(`SELECT o.*, s.name supplierName, r.no requestNo FROM proc_orders o JOIN proc_suppliers s ON s.id=o.supplier_id LEFT JOIN proc_requests r ON r.id=o.request_id ${where} ORDER BY o.id DESC LIMIT 300`).all(...a).map(r=>({id:r.id,no:r.no,requestId:r.request_id,requestNo:r.requestNo,supplierId:r.supplier_id,supplierName:r.supplierName,status:r.status,totalAmount:r.total_amount,orderedAt:r.ordered_at,receivedAt:r.received_at,note:r.note,createdBy:r.created_by,createdAt:r.created_at,lines:db.prepare('SELECT l.*, i.name itemName, i.code itemCode FROM proc_order_lines l LEFT JOIN proc_items i ON i.id=l.item_id WHERE l.order_id=?').all(r.id).map(x=>({id:x.id,itemId:x.item_id,itemCode:x.itemCode,itemName:x.itemName,description:x.description,qty:x.qty,unitCost:x.unit_cost,lineTotal:x.line_total}))}));
}
export function getOrder(db,id){
  const r=db.prepare('SELECT o.*, s.name supplierName FROM proc_orders o JOIN proc_suppliers s ON s.id=o.supplier_id WHERE o.id=?').get(Number(id)); if(!r) throw bad('أمر التوريد غير موجود.',404,'not_found');
  const lines=db.prepare('SELECT l.*, i.name itemName FROM proc_order_lines l LEFT JOIN proc_items i ON i.id=l.item_id WHERE l.order_id=?').all(r.id);
  return {order:{id:r.id,no:r.no,requestId:r.request_id,supplierId:r.supplier_id,supplierName:r.supplierName,status:r.status,totalAmount:r.total_amount,orderedAt:r.ordered_at,receivedAt:r.received_at,note:r.note,createdAt:r.created_at,lines:lines.map(x=>({id:x.id,itemId:x.item_id,itemName:x.itemName,description:x.description,qty:x.qty,unitCost:x.unit_cost,lineTotal:x.line_total}))}};
}
export function createOrder({db},actor,b,ip){
  const supId=Number(b?.supplierId); if(!supId || !db.prepare('SELECT 1 FROM proc_suppliers WHERE id=? AND active=1').get(supId)) throw bad('المورد غير موجود أو معطّل.');
  const reqId=b?.requestId?Number(b.requestId):null;
  if(reqId){ const rq=db.prepare('SELECT * FROM proc_requests WHERE id=?').get(reqId); if(!rq) throw bad('طلب الشراء غير موجود.',404,'not_found'); if(rq.status!=='approved') throw bad('طلب الشراء ليس معتمداً.',409,'conflict'); if(db.prepare("SELECT 1 FROM proc_orders WHERE request_id=? AND status!='cancelled' LIMIT 1").get(reqId)) throw bad('يوجد أمر توريد مرتبط بهذا الطلب.',409,'conflict'); }
  const lines=b?.lines; if(!Array.isArray(lines)||!lines.length) throw bad('أضف بنداً واحداً على الأقل.');
  for(let i=0;i<lines.length;i++){ const l=lines[i]; clean(l?.description,100,`وصف البند ${i+1}`,2); if(Number(l?.qty)<=0) throw bad(`البند ${i+1}: الكمية غير صالحة.`); if(Number(l?.unitCost)<0) throw bad(`البند ${i+1}: سعر الوحدة غير صالح.`); }
  return tx(db,()=>{
    const no=nextNo(db,'PO','proc_orders');
    const total=lines.reduce((s,l)=>s+Number(l.qty)*Number(l.unitCost||0),0);
    const id=Number(db.prepare('INSERT INTO proc_orders (no,request_id,supplier_id,status,total_amount,note,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)').run(no,reqId,supId,'draft',total,String(b?.note??'').slice(0,300),actor.id,Date.now()).lastInsertRowid);
    for(const l of lines) db.prepare('INSERT INTO proc_order_lines (order_id,item_id,description,qty,unit_cost,line_total) VALUES (?,?,?,?,?,?)').run(id,l.itemId?Number(l.itemId):null,clean(l.description,100,'وصف البند',1),Number(l.qty),Number(l.unitCost||0),Number(l.qty)*Number(l.unitCost||0));
    if(reqId) db.prepare("UPDATE proc_requests SET status='ordered' WHERE id=?").run(reqId);
    audit(db,actor,'إنشاء أمر توريد',no,ip); return getOrder(db,id);
  });
}
export function orderAction({db},actor,id,action,ip){
  const o=db.prepare('SELECT * FROM proc_orders WHERE id=?').get(Number(id)); if(!o) throw bad('أمر التوريد غير موجود.',404,'not_found');
  if(action==='order'){ if(o.status!=='draft') throw bad('الأمر ليس مسودة.',409,'conflict'); db.prepare("UPDATE proc_orders SET status='ordered', ordered_at=? WHERE id=?").run(Date.now(),o.id); audit(db,actor,'إرسال أمر توريد',o.no,ip); }
  else if(action==='cancel'){ if(!['draft','ordered'].includes(o.status)) throw bad('لا يمكن الإلغاء.',409,'conflict'); db.prepare("UPDATE proc_orders SET status='cancelled' WHERE id=?").run(o.id); audit(db,actor,'إلغاء أمر توريد',o.no,ip); }
  else throw bad('إجراء غير صالح.');
  return getOrder(db,o.id);
}
/* Receipts */
export function createReceipt({db},actor,b,ip){
  const orderId=Number(b?.orderId); const o=db.prepare('SELECT * FROM proc_orders WHERE id=?').get(orderId); if(!o) throw bad('أمر التوريد غير موجود.',404,'not_found');
  if(o.status!=='ordered') throw bad('أمر التوريد ليس مرسلاً.',409,'conflict');
  const lines=b?.lines; if(!Array.isArray(lines)||!lines.length) throw bad('أضف بنداً واحداً على الأقل.');
  return tx(db,()=>{
    const rid=Number(db.prepare('INSERT INTO proc_receipts (order_id,received_at,note,created_by,created_at) VALUES (?,?,?,?,?)').run(orderId,Date.now(),String(b?.note??'').slice(0,300),actor.id,Date.now()).lastInsertRowid);
    for(const l of lines){
      const itemId=Number(l.itemId); if(!itemId || !db.prepare('SELECT 1 FROM proc_items WHERE id=?').get(itemId)) throw bad('الصنف غير موجود.');
      const qty=Number(l.qty); if(qty<=0) throw bad('الكمية غير صالحة.');
      const cost=Number(l.unitCost??0);
      db.prepare('INSERT INTO proc_receipt_lines (receipt_id,item_id,qty,unit_cost) VALUES (?,?,?,?)').run(rid,itemId,qty,cost);
      const it=db.prepare('SELECT qty_on_hand, avg_cost FROM proc_items WHERE id=?').get(itemId);
      const newQty=it.qty_on_hand+qty;
      const newAvg=newQty>0?Math.round((it.avg_cost*it.qty_on_hand + cost*qty)/newQty):cost;
      db.prepare('UPDATE proc_items SET qty_on_hand=?, avg_cost=? WHERE id=?').run(newQty,newAvg,itemId);
    }
    db.prepare("UPDATE proc_orders SET status='received', received_at=? WHERE id=?").run(Date.now(),orderId);
    audit(db,actor,'استلام توريد',o.no,ip); return {receiptId:rid};
  });
}
export function listReceipts(db,q={}){
  const where=q.orderId?'WHERE r.order_id=?':''; const a=q.orderId?[Number(q.orderId)]:[];
  return db.prepare(`SELECT r.*, o.no orderNo, s.name supplierName FROM proc_receipts r JOIN proc_orders o ON o.id=r.order_id JOIN proc_suppliers s ON s.id=o.supplier_id ${where} ORDER BY r.id DESC LIMIT 200`).all(...a).map(r=>({id:r.id,orderId:r.order_id,orderNo:r.orderNo,supplierName:r.supplierName,receivedAt:r.received_at,note:r.note,lines:db.prepare('SELECT l.*, i.name itemName, i.code itemCode FROM proc_receipt_lines l JOIN proc_items i ON i.id=l.item_id WHERE l.receipt_id=?').all(r.id).map(x=>({itemId:x.item_id,itemCode:x.itemCode,itemName:x.itemName,qty:x.qty,unitCost:x.unit_cost}))}));
}
/* Issues */
export function createIssue({db},actor,b,ip){
  const whId=Number(b?.warehouseId); if(!whId || !db.prepare('SELECT 1 FROM proc_warehouses WHERE id=?').get(whId)) throw bad('المخزن غير موجود.');
  const to=clean(b?.issuedTo,60,'الجهة المستلمة',2); const purpose=String(b?.purpose??'').slice(0,200);
  const lines=b?.lines; if(!Array.isArray(lines)||!lines.length) throw bad('أضف بنداً واحداً على الأقل.');
  return tx(db,()=>{
    for(const l of lines){ const it=db.prepare('SELECT qty_on_hand FROM proc_items WHERE id=?').get(Number(l.itemId)); if(!it) throw bad('الصنف غير موجود.'); if(Number(l.qty)>it.qty_on_hand) throw bad(`الصنف ${l.itemId}: الرصيد لا يكفي (${it.qty_on_hand} متاح).`); }
    const no=nextNo(db,'IS','proc_issues');
    const id=Number(db.prepare('INSERT INTO proc_issues (no,warehouse_id,issued_to,purpose,issued_at,created_by,created_at) VALUES (?,?,?,?,?,?,?)').run(no,whId,to,purpose,Date.now(),actor.id,Date.now()).lastInsertRowid);
    for(const l of lines){
      db.prepare('INSERT INTO proc_issue_lines (issue_id,item_id,qty) VALUES (?,?,?)').run(id,Number(l.itemId),Number(l.qty));
      db.prepare('UPDATE proc_items SET qty_on_hand = qty_on_hand - ? WHERE id=?').run(Number(l.qty),Number(l.itemId));
    }
    audit(db,actor,'صرف مخزني',no,ip); return {issueId:id,no};
  });
}
export function listIssues(db,q={}){
  const w=[],a=[]; if(q.warehouse){w.push('i.warehouse_id=?');a.push(Number(q.warehouse));}
  const where=w.length?'WHERE '+w.join(' AND '):'';
  return db.prepare(`SELECT i.*, w.name whName FROM proc_issues i JOIN proc_warehouses w ON w.id=i.warehouse_id ${where} ORDER BY i.id DESC LIMIT 200`).all(...a).map(r=>({id:r.id,no:r.no,warehouseId:r.warehouse_id,warehouseName:r.whName,issuedTo:r.issued_to,purpose:r.purpose,issuedAt:r.issued_at,lines:db.prepare('SELECT l.*, it.name itemName, it.code itemCode FROM proc_issue_lines l JOIN proc_items it ON it.id=l.item_id WHERE l.issue_id=?').all(r.id).map(x=>({itemId:x.item_id,itemCode:x.itemCode,itemName:x.itemName,qty:x.qty}))}));
}
/* Assets */
export function listAssets(db,q={}){
  const w=[],a=[]; if(q.status){w.push('a.status=?');a.push(q.status);} if(q.q){const l='%'+String(q.q).replace(/[\\%_]/g,'\\$&')+'%'; w.push('(a.name LIKE ? ESCAPE "\\" OR a.code LIKE ? ESCAPE "\\")'); a.push(l,l);} if(q.warehouse){w.push('a.warehouse_id=?');a.push(Number(q.warehouse));}
  const where=w.length?'WHERE '+w.join(' AND '):'';
  return db.prepare(`SELECT a.*, w.name whName, s.name supName FROM proc_assets a LEFT JOIN proc_warehouses w ON w.id=a.warehouse_id LEFT JOIN proc_suppliers s ON s.id=a.supplier_id ${where} ORDER BY a.id DESC LIMIT 500`).all(...a).map(r=>({id:r.id,code:r.code,name:r.name,category:r.category,warehouseId:r.warehouse_id,warehouseName:r.whName,status:r.status,purchaseDay:r.purchase_day,cost:r.cost,supplierId:r.supplier_id,supplierName:r.supName,assignedTo:r.assigned_to,notes:r.notes,createdAt:r.created_at}));
}
export function createAsset({db},actor,b,ip){
  const code=clean(b?.code,20,'رمز الأصل'); const name=clean(b?.name,80,'اسم الأصل',2);
  if(db.prepare('SELECT 1 FROM proc_assets WHERE code=?').get(code)) throw bad('رمز الأصل مستخدم.',409,'conflict');
  const whId=b?.warehouseId?Number(b.warehouseId):null; if(whId && !db.prepare('SELECT 1 FROM proc_warehouses WHERE id=?').get(whId)) throw bad('المخزن غير موجود.');
  const supId=b?.supplierId?Number(b.supplierId):null; if(supId && !db.prepare('SELECT 1 FROM proc_suppliers WHERE id=?').get(supId)) throw bad('المورد غير موجود.');
  const day=b?.purchaseDay?String(b.purchaseDay):null; if(day && !isDay(day)) throw bad('تاريخ الشراء غير صالح.');
  const id=Number(db.prepare('INSERT INTO proc_assets (code,name,category,warehouse_id,status,purchase_day,cost,supplier_id,assigned_to,notes,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(code,name,String(b?.category??'عام').slice(0,30),whId,String(b?.status??'available'),day,Number(b?.cost??0),supId,String(b?.assignedTo??'').slice(0,80),String(b?.notes??'').slice(0,300),Date.now()).lastInsertRowid);
  audit(db,actor,'إضافة أصل',code,ip); return {asset: db.prepare('SELECT * FROM proc_assets WHERE id=?').get(id)};
}
export function updateAsset({db},actor,id,b,ip){
  const cur=db.prepare('SELECT * FROM proc_assets WHERE id=?').get(Number(id)); if(!cur) throw bad('الأصل غير موجود.',404,'not_found');
  const code=b?.code?clean(b.code,20,'رمز الأصل'):cur.code; const name=b?.name?clean(b.name,80,'اسم الأصل',2):cur.name;
  if(code!==cur.code && db.prepare('SELECT 1 FROM proc_assets WHERE code=? AND id!=?').get(code,cur.id)) throw bad('رمز الأصل مستخدم.',409,'conflict');
  const whId=b?.warehouseId!==undefined?(b.warehouseId?Number(b.warehouseId):null):cur.warehouse_id;
  const status=b?.status??cur.status; if(!['available','in_use','maintenance','disposed'].includes(status)) throw bad('حالة الأصل غير صالحة.');
  db.prepare('UPDATE proc_assets SET code=?,name=?,category=?,warehouse_id=?,status=?,purchase_day=?,cost=?,supplier_id=?,assigned_to=?,notes=? WHERE id=?').run(code,name,String(b?.category??cur.category).slice(0,30),whId,status,b?.purchaseDay??cur.purchase_day, b?.cost!==undefined?Number(b.cost):cur.cost, b?.supplierId!==undefined?(b.supplierId?Number(b.supplierId):null):cur.supplier_id, String(b?.assignedTo??cur.assigned_to).slice(0,80), String(b?.notes??cur.notes).slice(0,300), cur.id);
  audit(db,actor,'تعديل أصل',code,ip); return {asset: db.prepare('SELECT * FROM proc_assets WHERE id=?').get(cur.id)};
}
export function moveAsset({db},actor,id,b,ip){
  const cur=db.prepare('SELECT * FROM proc_assets WHERE id=?').get(Number(id)); if(!cur) throw bad('الأصل غير موجود.',404,'not_found');
  const kind=String(b?.kind??'transfer'); if(!['transfer','dispose','maintenance','return'].includes(kind)) throw bad('نوع الحركة غير صالح.');
  const toWh=b?.toWarehouseId?Number(b.toWarehouseId):null; const toUser=String(b?.toUser??'').slice(0,80); const reason=String(b?.reason??'').slice(0,200);
  if(kind==='transfer' && !toWh) throw bad('حدد المخزن الهدف للنقل.');
  const newStatus=kind==='dispose'?'disposed':kind==='maintenance'?'maintenance':kind==='return'?'available':cur.status;
  const finalWh=kind==='transfer'?toWh:cur.warehouse_id;
  const finalUser=kind==='transfer'?toUser:cur.assigned_to;
  tx(db,()=>{
    db.prepare('INSERT INTO proc_asset_moves (asset_id,kind,from_wh,to_wh,to_user,reason,moved_at,moved_by) VALUES (?,?,?,?,?,?,?,?)').run(cur.id,kind,cur.warehouse_id,toWh,toUser,reason,Date.now(),actor.id);
    db.prepare('UPDATE proc_assets SET warehouse_id=?, assigned_to=?, status=? WHERE id=?').run(finalWh,finalUser,newStatus,cur.id);
  });
  audit(db,actor,'حركة أصل',`${cur.code}:${kind}`,ip); return {asset: db.prepare('SELECT * FROM proc_assets WHERE id=?').get(cur.id)};
}
export function deleteAsset({db},actor,id,ip){
  const a=db.prepare('SELECT * FROM proc_assets WHERE id=?').get(Number(id)); if(!a) throw bad('الأصل غير موجود.',404,'not_found');
  if(a.status==='in_use') throw bad('الأصل قيد الاستخدام فلا يُحذف.',409,'conflict');
  db.prepare('DELETE FROM proc_asset_moves WHERE asset_id=?').run(a.id); db.prepare('DELETE FROM proc_assets WHERE id=?').run(a.id); audit(db,actor,'حذف أصل',a.code,ip); return {ok:true};
}
/* Overview */
export function overview(db){
  return {
    warehouses: db.prepare('SELECT COUNT(*) c FROM proc_warehouses WHERE active=1').get().c,
    suppliers: db.prepare('SELECT COUNT(*) c FROM proc_suppliers WHERE active=1').get().c,
    items: db.prepare('SELECT COUNT(*) c FROM proc_items WHERE active=1').get().c,
    lowStock: db.prepare('SELECT COUNT(*) c FROM proc_items WHERE active=1 AND min_stock>0 AND qty_on_hand<=min_stock').get().c,
    totalStockValue: db.prepare('SELECT COALESCE(SUM(qty_on_hand*avg_cost),0) c FROM proc_items').get().c,
    pendingRequests: db.prepare("SELECT COUNT(*) c FROM proc_requests WHERE status='pending'").get().c,
    approvedRequests: db.prepare("SELECT COUNT(*) c FROM proc_requests WHERE status='approved'").get().c,
    pendingOrders: db.prepare("SELECT COUNT(*) c FROM proc_orders WHERE status='ordered'").get().c,
    totalAssets: db.prepare("SELECT COUNT(*) c FROM proc_assets WHERE status!='disposed'").get().c,
    assetsValue: db.prepare("SELECT COALESCE(SUM(cost),0) c FROM proc_assets WHERE status!='disposed'").get().c,
    recentRequests: db.prepare('SELECT r.no, r.title, r.status, u.display_name requester FROM proc_requests r LEFT JOIN users u ON u.id=r.requester_id ORDER BY r.id DESC LIMIT 6').all(),
    recentOrders: db.prepare('SELECT o.no, s.name supplierName, o.status FROM proc_orders o JOIN proc_suppliers s ON s.id=o.supplier_id ORDER BY o.id DESC LIMIT 6').all()
  };
}
