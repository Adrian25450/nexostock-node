require('dotenv').config();
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('NexoDemo2026!', 12);
  const admin = await prisma.user.upsert({ where: { email: 'admin@nexostock.local' }, update: {}, create: { name: 'Administración', email: 'admin@nexostock.local', passwordHash, role: 'ADMIN' } });
  const operator = await prisma.user.upsert({ where: { email: 'operador@nexostock.local' }, update: {}, create: { name: 'Equipo de bodega', email: 'operador@nexostock.local', passwordHash: await bcrypt.hash('OperadorDemo2026!', 12), role: 'OPERADOR' } });
  const suppliers = [];
  for (const name of ['TecnoDistribuciones', 'Suministros del Valle', 'Importadora Central']) {
    suppliers.push(await prisma.supplier.upsert({ where: { name }, update: {}, create: { name } }));
  }
  const products = [
    ['TEC-001','Portátil empresarial','Cómputo',8,3,2850000,0],['TEC-002','Monitor 24 pulgadas','Cómputo',14,5,689000,0],
    ['PER-010','Teclado mecánico','Periféricos',22,8,189000,1],['PER-011','Mouse inalámbrico','Periféricos',6,10,76000,1],
    ['RED-020','Router gigabit','Redes',4,5,329000,2],['RED-021','Cable de red CAT6 · 10 m','Redes',31,12,28000,2],
    ['ACC-031','Base para portátil','Accesorios',17,6,95000,1],['ACC-032','Webcam HD','Accesorios',3,5,215000,0]
  ];
  for (const [sku,name,category,quantity,minStock,unitPrice,index] of products) {
    const product = await prisma.product.upsert({ where: { sku }, update: {}, create: { sku,name,category,quantity,minStock,unitPrice,supplierId:suppliers[index].id,description:`Referencia de demostración · ${category.toLowerCase()}` } });
    if (!(await prisma.movement.count({ where: { productId: product.id } }))) {
      await prisma.movement.create({ data: { productId:product.id,userId:admin.id,kind:'ENTRADA',quantity,note:'Carga inicial de demostración' } });
    }
  }
  console.log(`Datos demo listos: ${admin.email} y ${operator.email}`);
}

main().catch(error => { console.error(error); process.exitCode=1; }).finally(() => prisma.$disconnect());

