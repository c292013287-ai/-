import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('开始种子数据初始化...');

  // 创建默认管理员
  const hashedPassword = await bcrypt.hash('admin123', 10);
  const admin = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      password: hashedPassword,
      name: '系统管理员',
      role: 'admin',
      status: 'active',
    },
  });
  console.log(`管理员创建成功: ${admin.username}`);

  // 创建示例企微主体
  const entities = [
    { name: '主体A-科技公司', corpid: 'ww1234567890abcdef', secret: 'demo_secret_a_xxxxxxxxxxxxx' },
    { name: '主体B-电商平台', corpid: 'ww0987654321fedcba', secret: 'demo_secret_b_xxxxxxxxxxxxx' },
    { name: '主体C-教育机构', corpid: 'wwabcdef1234567890', secret: 'demo_secret_c_xxxxxxxxxxxxx' },
  ];

  for (const entity of entities) {
    const created = await prisma.wecomEntity.upsert({
      where: { id: entities.indexOf(entity) + 1 },
      update: {},
      create: {
        ...entity,
        quotaTotal: 10000,
        quotaBalance: 8500,
      },
    });
    console.log(`主体创建成功: ${created.name}`);
  }

  // 创建示例消耗记录（最近 7 天）
  const today = new Date();
  for (let i = 6; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    date.setHours(0, 0, 0, 0);

    for (let entityId = 1; entityId <= 3; entityId++) {
      const consumption = Math.floor(Math.random() * 200) + 50;
      const calls = Math.floor(Math.random() * 50) + 10;

      await prisma.consumptionRecord.upsert({
        where: {
          entityId_date: { entityId, date },
        },
        create: { entityId, date, consumption, calls },
        update: { consumption, calls },
      });
    }
  }
  console.log('消耗记录创建成功');

  console.log('种子数据初始化完成！');
  console.log('默认账号: admin / admin123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
