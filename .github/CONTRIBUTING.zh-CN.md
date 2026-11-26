# 参与开发

[English](CONTRIBUTING.md) | 简体中文

## 环境准备

需要 macOS、[Raycast](https://raycast.com)、Node.js 22+ 和 npm。

```bash
git clone https://github.com/iyekChen/logic-project-manager.git
cd logic-project-manager
npm install
npm run dev        # 以 Raycast 开发模式运行扩展
```

首次启动时，Search Projects 会要求选择 Projects Folder。请使用测试文件夹，不要用你真正的项目库，因为重命名、Move to Trash 等操作会改动磁盘上的文件。

在开发模式下，Search Projects 多一个 **Reset Onboarding (Dev)** 操作，用来测试首次启动时的提示。

## 脚本

```bash
npm run lint          # ESLint + Prettier
npm run fix-lint      # 自动修复 lint 和格式问题
npm run build         # 构建正式版扩展
```

提交 PR 前，请运行 lint 和构建。CI 会在 macOS 和 Node 22 上用 `npm ci` 安装依赖，执行同样的步骤。

单元测试放在另一个私有仓库里，这个仓库不带测试。

## 项目结构

- `src/*.tsx` 是命令入口，每个命令一个文件。Manage Tags 对应 `manage-categories.tsx`。
- `src/core/` 包含所有不针对 Logic Pro 的部分：项目、bounce、合集、笔记、搜索和存储。
- `src/daws/logic/` 包含 Logic 专用的部分：读取 `.logicx` 包、Alternatives 视图和编辑 Alternative。它们通过 `src/daws/types.ts` 中的 `DawAdapter` 接口接入其余部分。
- 大部分界面文字在 `src/strings.ts` 中。Logic 专用的文字在 `src/daws/labels.ts` 和 `src/daws/logic/strings.ts` 中，命令和设置项的标题在 `package.json` 中。
- `swift/audio-player/` 是音频播放器的 Swift package，由 `ray build` 编译。

## 音频播放器

音频播放器是 `swift/audio-player/` 里的 Swift package，用 [extensions-swift-tools](https://github.com/raycast/extensions-swift-tools) 构建。`ray build` 会编译它，所以没有单独的构建步骤，仓库里也不放二进制文件。构建需要 Xcode 16.3 或更新版本。

[`swift/audio-player/Sources/AudioPlayer.swift`](https://github.com/iyekChen/logic-project-manager/blob/main/swift/audio-player/Sources/AudioPlayer.swift) 向 TypeScript 导出三个函数：`startPlayer` 启动脱离的 worker 并返回它的 pid，`runPlayer` 是播放循环，`analyzeAudio` 负责测量音频。插件会生成 `main.swift`，所以这个文件里不能有顶层语句，也不能有 `@main`。

## 工作原理

- **Logic 工程：** 一个项目就是一个 `.logicx` 包。每个 Alternative 是 `Alternatives/` 下的一个编号文件夹。它的速度、拍号和调性从 `MetaData.plist` 读取，Alternative 名称和 Active Alternative 从 `Resources/ProjectInformation.plist` 读取，两者都用内置的二进制 plist 读取器。对 Alternative 的改动通过 macOS 的 `/usr/bin/plutil` 写入，保持二进制格式。
- **播放：** 一个基于 AVFoundation 的 Swift worker 以独立进程播放 bounce，所以切换视图或关闭 Raycast 窗口后，播放不会中断。扩展通过其支持文件夹中的命令文件和状态文件控制它。Raycast 退出时，播放器会自行停止。
- **分析：** 同一个 Swift package 有一个 `analyzeAudio` 函数，分块流式读取文件，用 2048 点 FFT 计算 RMS、峰值、频谱质心和频谱通量，不会把整个文件读进内存。
