import type { RunContextEventPayload, ToolCallRecord } from "./stream-types";

export type ChatRole="user" |"assistant"
export type ChatMode="default"|"web"|"nearby"

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  category?: string;
  status?: "active" | "draft" | "deprecated";
  version?: string;
  owner?: string;
  whenToUse: string[];
  instruction: string;
}

export interface SkillIndexEntry extends SkillDefinition {
  file?: string;
}

export interface SkillIndexDefinition {
  version: string;
  skills: SkillIndexEntry[];
}

export interface McpServerAuthDefinition {
  type: "apiKey" | "bearer" | "none";
  envKey?: string;
}

export interface McpProviderDefinition {
  name: string;
  transport: "http" | "stdio" | "mock";
  baseUrl?: string;
  auth: McpServerAuthDefinition;
  fallbackProviders?: string[];
}

export interface McpServerDefinition {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  modes: ChatMode[];
  enabled?: boolean;
  provider: McpProviderDefinition;
  adapter: string;
}

export interface HarnessCheck {
  name: string;
  expectation: string;
}

export interface HarnessTrace {
  runId: string;
  mode: ChatMode;
  plannedRoute: string;
  activeSkillIds: string[];
  activeMcpServerIds: string[];
  checks: HarnessCheck[];
 }

export interface AgentRunContext {
  mode: ChatMode;
  activeSkills: SkillDefinition[];
  activeMcpServers: McpServerDefinition[];
  harness: HarnessTrace;
}

export interface ChatMessage{
  id:string;
  role:ChatRole;
  content:string;
  createdAt:number;
  toolCalls?:ToolCallRecord[];
  runContext?: RunContextEventPayload;
}

// 创建会话接口
export interface ChatSession{
  id:string;
  title:string;
  // 每个会话都要有自己的消息数组
  messages:ChatMessage[];
  messageCount?:number;
  createdAt: number;
  updatedAt: number;
}

export interface AgentRequestBody{
  message:string;
  messages?:ChatMessage[];
  sessionId?:string;
  mode?:ChatMode;
  attachments?: UploadedAttachment[];
}

export interface RunAssistantResult {
  reply: string;
  toolCalls: ToolCallRecord[];
  context: AgentRunContext;
}

export interface LocationApiResponse{
  status: "success" | "fail";
  message?:string;
  // 国家
  country?:string;
  // 地区
  regionName?:string;
  // 城市
  city?:string;
  // 经度
  lat?:number;
  // 纬度
  lon?:number;
  // 时区
  timezone?:string;
  // 查询的ip地址
  query?:string
}

// 定义地理编码接口里单个地点的结果
export interface AmapGeocodeItem {

  location: string; // "经度,纬度"
}

export interface AmapGeocodeResponse {
  status: string; // "1" 成功, "0" 失败
  info: string;
  geocodes?: AmapGeocodeItem[];
}
// 天气接口current结构
export interface ForecastCurrent{
  time:string;
  // 当前温度
  temperature_2m:number;
  // 相对湿度
  relative_humidity_2m:number;
  // 体感温度
  apparent_temperature:number;
  // 降水量
  precipitation:number;
  // 天气编码
  weather_code:number;
  // 10m风速
  wind_speed_10m:number
}

 export interface ForecastApiResponse{
  current?:ForecastCurrent;
}

export interface UploadedAttachment{
  id:string,
  name:string,
  mimeType:string,
  size:number,
  kind:"image"|"text"|"file",
  // 只给txt/md/json/csv用
  extractedText?:string 
}

// 附近类型接口
export interface NearbyPoi{
   id:string;
   name:string;
   address:string;
   location:string;
   distance?:string;
   type?:string
}

// 定义高德返回的一条地点数据长什么样
export interface AmapPoiItem{
  id:string;
  name:string;
  address?:string;
  location:string;
  distance?:string;
  type?:string;
}

// 高德周边地点搜索接口
export interface AmapPlaceSearchResponse{
  status:string;
  info:string;
  pois?:AmapPoiItem[]
}

export interface TavilySearchResultItem {
  title: string;
  url: string;
  content?: string;
  score?: number;
}

export interface TavilySearchResponse {
  answer?: string;
  results?: TavilySearchResultItem[];
}
