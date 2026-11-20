require('dotenv').config();
const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const app=express(), prisma=new PrismaClient();
const dataDir=path.join(__dirname,'..','data'); fs.mkdirSync(dataDir,{recursive:true});
app.disable('x-powered-by'); app.use(helmet()); app.use(express.json({limit:'20kb'}));
app.use(session({store:new SQLiteStore({db:'sessions.db',dir:dataDir}),name:'nexostock.sid',secret:process.env.SESSION_SECRET||'local-demo-only-change-this-secret',resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:8*60*60*1000}}));
app.use(express.static(path.join(__dirname,'..','public')));
const authLimit=rateLimit({windowMs:15*60*1000,limit:20,standardHeaders:'draft-7',legacyHeaders:false});
const writeLimit=rateLimit({windowMs:60*1000,limit:90,standardHeaders:'draft-7',legacyHeaders:false});
const clean=(value,max=120)=>typeof value==='string'?value.trim().slice(0,max):'';
const int=(value,min=0,max=100000000)=>Number.isInteger(value)&&value>=min&&value<=max;
const fail=(res,status,error)=>res.status(status).json({error});
const roles={ADMIN:['ADMIN','OPERADOR','LECTOR'],OPERADOR:['OPERADOR','LECTOR'],LECTOR:['LECTOR']};
function auth(req,res,next){if(!req.session.user)return fail(res,401,'Inicia sesión para continuar.'); next();}
function permit(...allowed){return (req,res,next)=>!req.session.user||!allowed.includes(req.session.user.role)?fail(res,403,'Tu rol no permite esta acción.'):next();}
function asyncRoute(fn){return (req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);}
function productBody(data,partial=false){
  if(!data||typeof data!=='object'||Array.isArray(data))throw Object.assign(new Error('Envía un objeto JSON válido.'),{status:400});
  const out={};
  for(const [key,max] of [['sku',40],['name',120],['category',60],['description',500]]) if(data[key]!==undefined||(!partial&&key!=='description')){const v=clean(data[key],max);if(!v&&key!=='description')throw Object.assign(new Error(`${key} es obligatorio.`),{status:400});out[key]=v;}
  for(const [key,target,max] of [['quantity','quantity',1000000],['minStock','minStock',1000000],['unitPrice','unitPrice',1000000000]]) if(data[key]!==undefined||!partial){const value=data[key]??0;if(!int(value,0,max))throw Object.assign(new Error(`${key} debe ser un entero válido.`),{status:400});out[target]=value;}
  if(data.supplierId!==undefined||!partial){const value=data.supplierId??null;if(value!==null&&!int(value,1,2147483647))throw Object.assign(new Error('Proveedor inválido.'),{status:400});out.supplierId=value;}
  return out;
}
function escapedCsv(value){const text=String(value??'');return `"${text.replaceAll('"','""')}"`;}

app.get('/api/health',(req,res)=>res.json({status:'ok',app:'NexoStock'}));
app.post('/api/auth/login',authLimit,asyncRoute(async(req,res)=>{
  const email=clean(req.body?.email,160).toLowerCase(),password=typeof req.body?.password==='string'?req.body.password:'';
  const user=await prisma.user.findUnique({where:{email}});
  if(!user||!user.active||!(await bcrypt.compare(password,user.passwordHash)))return fail(res,401,'Correo o contraseña incorrectos.');
  await new Promise((resolve,reject)=>req.session.regenerate(err=>err?reject(err):resolve()));
  req.session.user={id:user.id,name:user.name,email:user.email,role:user.role}; res.json({user:req.session.user});
}));
app.post('/api/auth/logout',(req,res)=>req.session.destroy(()=>{res.clearCookie('nexostock.sid',{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production'});res.json({ok:true});}));
app.get('/api/me',auth,(req,res)=>res.json({user:req.session.user,permissions:roles[req.session.user.role]}));

app.get('/api/dashboard',auth,asyncRoute(async(req,res)=>{
  const [aggregate,products,byCategory,recent]=await Promise.all([
    prisma.product.aggregate({where:{active:true},_count:{id:true},_sum:{quantity:true,unitPrice:true}}),
    prisma.product.findMany({where:{active:true},orderBy:{name:'asc'},include:{supplier:{select:{id:true,name:true}}}}),
    prisma.product.groupBy({by:['category'],where:{active:true},_sum:{quantity:true},_count:{id:true}}),
    prisma.movement.findMany({take:8,orderBy:{createdAt:'desc'},include:{product:{select:{sku:true,name:true}},user:{select:{name:true}}}})
  ]);
  const lowStock=products.filter(p=>p.quantity<=p.minStock).sort((a,b)=>a.quantity-b.quantity).slice(0,8);
  const inventoryValue=products.reduce((sum,p)=>sum+p.quantity*p.unitPrice,0);
  res.json({metrics:{products:aggregate._count.id||0,units:aggregate._sum.quantity||0,inventoryValue,lowStock:lowStock.length},lowStock:lowStock.map(p=>({...p,stockStatus:p.quantity===0?'AGOTADO':'BAJO'})),categories:byCategory,recent});
}));

app.get('/api/products',auth,asyncRoute(async(req,res)=>{
  const q=clean(req.query.q,100),category=clean(req.query.category,60),stock=req.query.stock;
  const where={active:true};
  if(q)where.OR=[{sku:{contains:q}},{name:{contains:q}},{category:{contains:q}}];
  if(category&&category!=='Todas')where.category=category;
  if(stock==='low')where.quantity={lte:0};
  const products=await prisma.product.findMany({where,orderBy:{name:'asc'},include:{supplier:{select:{id:true,name:true}}},take:500});
  const full=stock==='low'?products.filter(p=>p.quantity<=p.minStock):products;
  res.json({items:full,count:full.length});
}));
app.post('/api/products',auth,permit('ADMIN','OPERADOR'),writeLimit,asyncRoute(async(req,res)=>{
  const data=productBody(req.body); const initialQuantity=data.quantity; data.quantity=0;
  const product=await prisma.$transaction(async tx=>{
    const created=await tx.product.create({data});
    if(initialQuantity>0)await tx.movement.create({data:{productId:created.id,userId:req.session.user.id,kind:'ENTRADA',quantity:initialQuantity,note:'Existencia inicial al crear referencia'}});
    return tx.product.findUnique({where:{id:created.id},include:{supplier:{select:{id:true,name:true}}}});
  });
  res.status(201).json(product);
}));
app.patch('/api/products/:id',auth,permit('ADMIN','OPERADOR'),writeLimit,asyncRoute(async(req,res)=>{
  const id=Number(req.params.id);if(!int(id,1,2147483647))return fail(res,400,'Identificador inválido.');
  if(req.body?.quantity!==undefined)return fail(res,400,'Registra cambios de existencias desde Movimientos para conservar la trazabilidad.');
  const data=productBody(req.body,true);if(!Object.keys(data).length)return fail(res,400,'No hay campos para actualizar.');
  const product=await prisma.product.update({where:{id,active:true},data,include:{supplier:{select:{id:true,name:true}}}});res.json(product);
}));
app.delete('/api/products/:id',auth,permit('ADMIN'),writeLimit,asyncRoute(async(req,res)=>{
  const id=Number(req.params.id);if(!int(id,1,2147483647))return fail(res,400,'Identificador inválido.');
  await prisma.product.update({where:{id,active:true},data:{active:false}});res.json({ok:true});
}));

app.post('/api/products/:id/movements',auth,permit('ADMIN','OPERADOR'),writeLimit,asyncRoute(async(req,res)=>{
  const productId=Number(req.params.id),{kind,quantity}=req.body||{},note=clean(req.body?.note,240);
  if(!int(productId,1,2147483647))return fail(res,400,'Producto inválido.');
  if(!['ENTRADA','SALIDA'].includes(kind)||!int(quantity,1,1000000))return fail(res,400,'Tipo o cantidad de movimiento inválidos.');
  const movement=await prisma.$transaction(async tx=>{
    const product=await tx.product.findUnique({where:{id:productId}});
    if(!product||!product.active)throw Object.assign(new Error('Producto no encontrado.'),{status:404});
    const next=product.quantity+(kind==='ENTRADA'?quantity:-quantity);
    if(next<0)throw Object.assign(new Error('La salida supera las existencias disponibles.'),{status:409});
    await tx.product.update({where:{id:productId},data:{quantity:next}});
    return tx.movement.create({data:{productId,userId:req.session.user.id,kind,quantity,note},include:{product:{select:{sku:true,name:true}},user:{select:{name:true}}}});
  });
  res.status(201).json(movement);
}));
app.get('/api/movements',auth,asyncRoute(async(req,res)=>{
  const rows=await prisma.movement.findMany({take:150,orderBy:{createdAt:'desc'},include:{product:{select:{sku:true,name:true}},user:{select:{name:true}}}});res.json({items:rows});
}));
app.get('/api/suppliers',auth,asyncRoute(async(req,res)=>res.json({items:await prisma.supplier.findMany({orderBy:{name:'asc'},include:{_count:{select:{products:true}}}})})));
app.post('/api/suppliers',auth,permit('ADMIN','OPERADOR'),writeLimit,asyncRoute(async(req,res)=>{
  const name=clean(req.body?.name,120);if(!name)return fail(res,400,'El nombre del proveedor es obligatorio.');
  const supplier=await prisma.supplier.create({data:{name,email:clean(req.body?.email,160)||null,phone:clean(req.body?.phone,40)||null}});res.status(201).json(supplier);
}));
app.get('/api/export/products.csv',auth,asyncRoute(async(req,res)=>{
  const items=await prisma.product.findMany({where:{active:true},orderBy:{name:'asc'},include:{supplier:true}});
  const rows=[['SKU','Producto','Categoría','Existencias','Mínimo','Precio COP','Proveedor'],...items.map(p=>[p.sku,p.name,p.category,p.quantity,p.minStock,p.unitPrice,p.supplier?.name||''])];
  res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="nexostock-inventario.csv"');res.send('\ufeff'+rows.map(row=>row.map(escapedCsv).join(',')).join('\r\n'));
}));

app.use('/api',(req,res)=>fail(res,404,'Ruta no encontrada.'));
app.use((error,req,res,next)=>{
  if(error.code==='P2002')return fail(res,409,'Ese código SKU o nombre ya existe.');
  if(error.code==='P2025')return fail(res,404,'Registro no encontrado.');
  console.error('NexoStock request failed:',error.message);
  res.status(error.status||500).json({error:error.status?error.message:'Error interno. Inténtalo de nuevo.'});
});
const port=Number(process.env.PORT)||3000;
const server=app.listen(port,()=>console.log(`NexoStock listo en http://localhost:${port}`));
async function shutdown(){server.close();await prisma.$disconnect();}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);

