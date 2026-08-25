# 牛来 · Bull Run — 编辑器盯盘

在 VSCode 侧边栏和状态栏实时盯盘。支持 A股、指数、港股、美股。牛来了，牛市也来了。🐂

![views](media/container.svg)

## 功能

- **侧边栏自选股列表**：活动栏新增 📈 图标，点开即看自选股实时行情
- **▲▼ 涨跌标识 + 悬浮详情**：鼠标悬停看今开/最高/最低/昨收/成交量/成交额/行情时间
- **状态栏常驻行情**：可置顶单只，或轮播全部自选
- **智能添加**：支持 `600519` / `sh600519` / `hk00700` / `AAPL` / 名称 / 拼音首字母模糊搜索
- **交易时段感知**：A股交易时段高频刷新，休市自动降频，不浪费流量
- **点击打开详情**：点击自选股跳转东方财富行情页
- **数据持久化**：自选列表与置顶状态保存在本地

## 安装

### 方式一：安装打包好的 VSIX（推荐）

1. 双击 `stock-watch-0.1.0.vsix`，或
2. VSCode 里 `Extensions` 面板 → `···` → **Install from VSIX...** → 选择本目录下的 `stock-watch-0.1.0.vsix`

### 方式二：源码运行

```bash
cd vscode-stock-watch
npm install
npm run compile
```

然后用 VSCode 打开本目录，按 **F5**（Run → Start Debugging）启动 Extension Development Host 测试。

## 使用

| 操作 | 说明 |
|---|---|
| 添加自选 | 侧边栏面板标题栏 **＋**，或命令面板 `Stock Watch: 添加自选股`，快捷键 `Alt+S` |
| 移除自选 | 行内 ✕ 或右键菜单「从自选中移除」 |
| 置顶状态栏 | 行内 📌 或右键「置顶/取消置顶到状态栏」 |
| 刷新 | 标题栏 🔄 手动刷新；平时自动刷新 |
| 打开详情 | 点击股票行，跳浏览器行情页 |

## 配置项（stockWatch.*）

| 配置 | 默认 | 说明 |
|---|---|---|
| `refreshInterval` | 5 | 交易时段自动刷新间隔（秒） |
| `offHoursRefresh` | 60 | 非交易时段降频间隔（秒），0=不刷新 |
| `showStatusBar` | true | 是否显示状态栏行情 |
| `statusBarMode` | single | `single` 固定置顶股 / `rotate` 轮播 |
| `rotateInterval` | 5 | 轮播间隔（秒） |
| `statusBarAlignment` | right | 状态栏左/右对齐 |
| `indexCodes` | 上证/深成/创业板 | 指数列表（secid 格式） |
| `defaultStocks` | 600519 等 | 首次安装默认自选（6位代码） |

## 数据来源

东方财富公开行情接口（push2.eastmoney.com / searchapi.eastmoney.com），无需 API key。

**免责声明**：行情数据仅供参考，不构成投资建议。数据可能延迟或有误，请以交易所官方数据为准。
