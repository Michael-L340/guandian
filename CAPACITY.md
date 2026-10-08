# 容量与免费额度（2026-10-08 核对）

| 资源 | 官网原文（2026-10-08） | 本项目估算 | 结论 |
|---|---|---|---|
| Supabase 数据库 | 500 MB per project | 每年约 300 条判断 + 把握记录 + 事件，不到 5 MB | 十年不到 1% |
| Supabase 暂停 | Free projects are paused after 1 week of inactivity | 每日备份访问一次 | 不会暂停 |
| Supabase 项目数 | Limit of 2 active projects | 记账 PWA 1 个 + 本项目 1 个 | 名额用满，再做小工具要复用 |
| Supabase 流量 / 存储 | 5 GB egress / 1 GB storage | 只存文字，接近 0 | 忽略 |
| GitHub Pages | 1 GB site, 100 GB/month soft bandwidth | 不到 1 MB | 忽略 |
| Actions（私有仓库） | 2,000 minutes/month | 备份每天约 1 分钟，每月约 30 分钟 | 1.5% |
| 备份仓库大小 | 建议 1 GB 以内 | 每年不到 50 MB | 二十年内不用管 |
| 定时任务停用 | 公开仓库 60 天无活动停用；私有仓库文档没写 | 每天提交一次 | 不会触发 |
| 手机本地缓存 | localStorage 约 5 MB | 只存登录态 | 不会撞 |

**最先撞墙的不是容量，是自己停用。** 其次是 Supabase 的 2 个免费项目名额。

每次加表、加会长大的数据、上线前，重新去 supabase.com/pricing 和 docs.github.com 核对，再更新这张表。
