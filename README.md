# 极简日历卡片 · 静态公告发布版

这是“方案1：无域名静态发布版”完整套装。

## 文件说明

- `index.html`：前台日历卡片页面
- `admin.html`：后台发布页
- `notice.json`：远程公告数据文件

## 你现在要做的事

### 1）把前台页面中的公告地址改成相对路径
打开 `index.html`，确认里面这行是：

```js
var NOTICE_REMOTE_URL = "./notice.json";
```

这样前台就会自动读取同目录下的 `notice.json`。

### 2）把这 3 个文件上传到同一个网站目录
例如：

- `index.html`
- `admin.html`
- `notice.json`

都放在同一个目录里。

## 推荐托管方式

- GitHub Pages
- Cloudflare Pages
- Netlify
- Vercel
- Gitee Pages

都可以，不需要自己买域名。

## 公告发布流程

1. 打开 `admin.html`
2. 填写标题、内容、图片链接
3. 点“生成公告 JSON”或“下载 notice.json”
4. 用新下载的 `notice.json` 覆盖网站上的旧文件
5. 前台用户下次打开页面时，如果 `version` 变了，就会自动弹出新公告

## 弹窗规则

- 首次使用：自动弹一次欢迎公告
- 后续：只有 `notice.json` 里的 `version` 变化时才会再次弹出
- 如果 `version` 不变，则不会重复弹出

## 公告 JSON 格式

```json
{
  "version": "notice-20260522-001",
  "title": "系统公告",
  "content": "这里写你想发送的公告内容，可以多行显示。",
  "image": "https://example.com/notice.jpg",
  "time": "2026-05-22 21:30"
}
```

## 图片要求

- 建议使用可直接访问的图片链接
- 最好是 jpg/png/webp
- 如果图片源站防盗链，后台预览可能不显示，但前台也可能加载失败

## 注意

这个方案是静态版：
- 优点：便宜、简单、无需服务器
- 缺点：不是真登录后台，发布流程是“生成 JSON → 手动覆盖上传”

如果以后你想升级成真正后台登录发布，我可以再帮你做方案2。
