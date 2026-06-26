# Skills Registry

本目录用于沉淀 Agent 的可复用技能资产，而不是把所有回答策略直接写死在 prompt 或 TypeScript 代码中。

## 资产结构

- `index.json`
  统一维护当前可用 skills 的目录、元数据、触发线索与回答规则。

## 当前技能

### Weather Brief

- 用途：把天气工具返回的数据整理成用户可执行的建议。
- 触发：天气、温度、湿度、降雨、风速、体感等问题。
- 依赖：`get_weather_by_location`

### Web Research

- 用途：把联网检索结果转成更有依据的结论与对比。
- 触发：最新、新闻、官网、版本、更新等问题。
- 依赖：`search_web`

### Local Guide

- 用途：对周边地点做按意图和距离的推荐排序。
- 触发：附近、周边、咖啡店、餐厅、医院、商场等问题。
- 依赖：`search_nearby_places`

### Attachment Reader

- 用途：让 Agent 在回答时显式吸收附件上下文。
- 触发：用户上传附件或请求解读文档、文件、图片。
- 依赖：附件提取文本上下文

## 设计目标

- 可沉淀：skill 是资产，不是零散 prompt。
- 可运营：后续可以增加 owner、状态、版本、命中统计。
- 可扩展：新增 skill 时优先修改 `index.json`，尽量减少业务代码变更。
