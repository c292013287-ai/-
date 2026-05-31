import { PrismaClient } from '@prisma/client';
import { getQuotaBalance } from '../src/services/wecom';

const prisma = new PrismaClient();

async function main() {
  const NAME = '开合万象';
  const CORPID = 'ww19cc3579921c0231';
  const SECRET = '7HutDBeENeBVzwD36AZ5M7py3LGCEKgTR72UMJzIIo4';

  console.log('=== 配置企微主体 ===');

  // 1. 清理旧的 demo 数据
  console.log('清理 demo 数据...');
  await prisma.syncLog.deleteMany({ where: { entity: { name: { startsWith: '主体' } } } });
  await prisma.consumptionRecord.deleteMany({ where: { entity: { name: { startsWith: '主体' } } } });
  await prisma.wecomEntity.deleteMany({ where: { name: { startsWith: '主体' } } });

  // 2. 创建/更新真实主体
  console.log('写入主体...');
  const entity = await prisma.wecomEntity.upsert({
    where: { id: 1 },
    update: { name: NAME, corpid: CORPID, secret: SECRET },
    create: { name: NAME, corpid: CORPID, secret: SECRET, quotaTotal: 0, quotaBalance: 0 },
  });
  console.log(`  主体: ${entity.name} (ID:${entity.id})`);

  // 3. 同步企微数据
  console.log('\n=== 同步企微获客数据 ===');
  try {
    const quota = await getQuotaBalance(CORPID, SECRET);
    console.log(`  配额总量: ${quota.total}`);
    console.log(`  配额余额: ${quota.balance}`);
    console.log(`  获客链接数: ${quota.links.length}`);

    // 更新数据库
    await prisma.wecomEntity.update({
      where: { id: entity.id },
      data: {
        quotaTotal: quota.balance, // 用余额作为基准
        quotaBalance: quota.balance,
        lastSyncAt: new Date(),
      },
    });

    // 记录同步日志
    await prisma.syncLog.create({
      data: {
        entityId: entity.id,
        status: 'success',
        message: `余额:${quota.balance} 链接数:${quota.links.length}`,
      },
    });

    // 输出链接详情
    if (quota.links.length > 0) {
      console.log('\n  获客链接详情:');
      for (const link of quota.links) {
        console.log(`    - ${link.link_name}: 余额${link.balance}`);
      }
    }

    console.log('\n✅ 同步成功!');
  } catch (error: any) {
    console.error(`\n❌ 同步失败: ${error.message}`);
    await prisma.syncLog.create({
      data: {
        entityId: entity.id,
        status: 'failed',
        message: error.message,
      },
    });
  }
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
