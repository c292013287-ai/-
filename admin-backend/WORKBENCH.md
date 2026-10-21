# 我的工作台

- 记事本和待办保存到 MySQL，按系统登录用户的 `userId` 隔离。共用系统登录账号的使用者也共用这份工作台数据。
- 所有 `/api/workbench` 接口同时检查系统登录和现有主体管理二次验证，二次验证凭证需属于同一个用户。
- 更新、删除使用 `version` 防止旧窗口覆盖新内容。冲突返回 409，前端保留未保存的表单内容。
- 截止日期为日期值（不是提醒任务），界面以北京时间判断到期状态；当前不发送通知。

## 初始化 / 发布

在后端目录执行，仅新增工作台两张表，不清理其他表：

```sh
npx prisma db execute --file prisma/add-workbench.sql --schema prisma/schema.prisma
npm run db:generate
npm run build
```

随后重启后端并构建、发布前端。不要使用全库重置或删除现有同步数据。

## 测试

```sh
node --import tsx --test tests/workbench-input.test.mjs
node --import tsx --test tests/workbench.integration.mjs
```

集成测试仅接受本地数据库，临时测试账号及关联工作台内容会在结束时清理。
