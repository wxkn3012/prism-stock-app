# 5 分钟上线：Render 免费部署完整步骤

> 目标：拿到一个 `https://xxx.onrender.com` 的公网地址，手机随时能打开，能生成战绩分享链接。

---

## 第 0 步：准备（1 分钟）

需要的文件我已经打包好：**`prism-stock-app.zip`**（51KB），下载到电脑后解压。

你还需要两个账号（都免费，不会扣钱）：
- **GitHub** 账号 → 用来放代码
- **Render** 账号 → 用来跑服务（可以直接用 GitHub 账号登录，免注册）

---

## 第 1 步：注册 GitHub 并建仓库（2 分钟）

1. 打开 https://github.com/signup
2. 填邮箱、密码、用户名 → 验证邮箱 → 完成
3. 登录后点右上角 **`+`** → **New repository**
4. 填写：
   - **Repository name**：`prism-stock-app`
   - 选 **Public**（私有仓库 Render 免费版也能用，但 Public 最省事）
   - **不要**勾选 Add a README
5. 点 **Create repository**

### 上传代码

在新仓库页面，点 **uploading an existing file** 链接（或地址栏直接访问 `https://github.com/你的用户名/prism-stock-app/upload/main`）：

1. 把解压出来的 **`prism-stock-app` 文件夹里的所有内容**（不是文件夹本身）拖进去

   正确的仓库结构应该是：
   ```
   ├── server.js          ← 必须在根目录
   ├── package.json       ← 必须在根目录
   ├── index.html
   ├── share.html
   ├── render.yaml
   ├── css/style.css
   ├── js/*.js
   └── data/.gitkeep
   ```

2. 底部点 **Commit changes**

> ⚠️ 常见错误：把 `prism-stock-app` 文件夹本身拖进去，导致 `server.js` 变成 `prism-stock-app/server.js`。这样 Render 会启动失败。

---

## 第 2 步：注册 Render（2 分钟）

1. 打开 https://render.com
2. 点右上角 **Get Started** 或 **Sign Up**
3. 选 **GitHub** 登录（会自动授权，最省事）
   - 如果让你选授权范围，选 **All repositories** 或单独勾选 `prism-stock-app`
4. 进到 Dashboard（可能要求填一个名字，随便填）

---

## 第 3 步：创建 Web 服务（2 分钟）

1. 点右上角 **New +** → **Web Service**
2. 在仓库列表里找到 **`prism-stock-app`**，点 **Connect**
3. 按下表填写：

| 字段 | 填什么 |
|---|---|
| **Name** | `prism-stock-app`（这会变成你的域名前缀） |
| **Region** | `Singapore`（离中国最近，速度最快） |
| **Branch** | `main` |
| **Runtime** | `Node` |
| **Build Command** | `npm install`（或留空，本项目零依赖） |
| **Start Command** | `node server.js` |
| **Instance Type** | **Free** ← 一定要选这个 |

4. 点 **Create Web Service**

---

## 第 4 步：等它部署（1~3 分钟）

页面上会滚动显示构建日志，等到出现：

```
棱镜 PRISM 已启动
APP      : http://localhost:8823
```

并且顶部状态变成绿色的 **Live**，就成功了。

页面左上角会显示你的地址，形如：

```
https://prism-stock-app-xxxx.onrender.com
```

**这就是你的公网地址**，手机浏览器直接打开就能用。

---

## 第 5 步：生成分享链接

1. 手机打开 `https://你的地址.onrender.com`
2. 底部点「**我的**」→ **编辑** → 设置昵称
3. 点「**分享我的战绩**」→ **生成分享链接**
4. 得到 `https://你的地址.onrender.com/s/AbCdEf12`
5. 把这个链接发微信，对方点开就是只读战绩页（30 秒自动刷新）

---

## ⚠️ 免费版三个必须知道的坑

### 1. 15 分钟没人访问就会休眠

再次打开要等 **30~60 秒**唤醒（页面会显示加载中）。这是免费版机制，无法关闭。

### 2. 重新部署会清空数据

免费实例的文件系统是**临时的**，服务重启/休眠/重新部署 = 你的账户和战绩全部丢失（Render 官方明确说明免费版**不支持**持久磁盘）。

**解决办法（二选一）：**
- **接受它**：每次重新唤醒后，APP 会自动创建新账户，重新设置昵称、生成新链接即可。适合给朋友临时看。
- **换成云数据库**：接 Supabase 免费 Postgres（500MB 永久免费），数据不会丢。需要我改造的话告诉我。

### 3. 中国大陆访问可能较慢

Render 服务器在新加坡，国内访问速度一般（首次加载 2~5 秒）。如果嫌慢，可以换 Region 到 `Oregon` 试试，或者用国内云服务器（需 ICP 备案才能绑域名）。

---

## 部署失败怎么排查

| 现象 | 原因 | 解决 |
|---|---|---|
| 日志报 `Cannot find module server.js` | 文件传进了子文件夹 | 把 `server.js` 移到仓库根目录 |
| 日志报 `EADDRINUSE` | 端口写死 8823 | 本项目已用 `process.env.PORT`，确认你传的是最新版代码 |
| 状态一直 Building 卡住 | 免费版排队 | 等 5 分钟，或删掉重建 |
| 打开是 502 | 服务启动崩溃 | 看 Render 的 Logs 页找报错 |
| 手机打开空白 | HTTPS 证书还没签发 | 等 2 分钟刷新 |

---

## 想进一步优化？

- **换自己的域名**：Render 设置里 Add Custom Domain，加 CNAME 记录即可，SSL 自动签发（免费）
- **数据持久化**：升级到付费 $7/月即可挂持久磁盘；或改用 Supabase 免费数据库
- **自定义短域名**：在 `index.html` 里改品牌名（搜 "棱镜"）

有任何一步卡住，把报错截图发给我。
