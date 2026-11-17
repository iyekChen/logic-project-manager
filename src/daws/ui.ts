// DAW 专属的视图。和 index.ts 分开放：视图依赖 core，而 core 又引用 index.ts，放在一起会形成循环引用。
// 共用代码按 SetsView 这个名字引用，LPM 在这里接上 Logic 的 Alternatives 视图。
export { AlternativesView as SetsView } from "./logic/alternatives-view";
