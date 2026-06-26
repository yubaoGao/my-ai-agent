import { tool } from "@openai/agents";
import { z } from "zod";

import type {
  ForecastApiResponse,
  LocationApiResponse,
  AmapGeocodeResponse,
  TavilySearchResponse,
  NearbyPoi,
  AmapPlaceSearchResponse
} from "./types";
import type { AgentStreamEvent, ToolCallRecord } from "./stream-types";

interface DnsLookupResponse {
  dns?: {
    ip?: string;
  };
}

type ToolEventHandler = (event: AgentStreamEvent) => void;
const TOOL_HTTP_TIMEOUT_MS = 10000;

function ensureNotAborted(signal: AbortSignal) {
  if (signal.aborted) {
    throw new DOMException("请求被取消了", "AbortError");
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  signal: AbortSignal,
  timeoutMs = TOOL_HTTP_TIMEOUT_MS
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const handleAbort = () => controller.abort();

  signal.addEventListener("abort", handleAbort);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted && !signal.aborted) {
      throw new Error(`工具请求超时: ${url}`);
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
    signal.removeEventListener("abort", handleAbort);
  }
}

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetchWithTimeout(url, {}, signal);

  if (!response.ok) {
    throw new Error(`请求失败: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

async function getLocationFromCurrentIp(
  signal: AbortSignal
): Promise<LocationApiResponse> {
  try {
  const directLocation = await fetchJson<LocationApiResponse>(
    "http://ip-api.com/json?fields=status,message,country,regionName,city,lat,lon,timezone,query",
    signal
  );

  if (directLocation.status === "success") {
    return directLocation;
  }
  } catch {
    // Fall back to the resolved-IP lookup below.
  }

  try {
  const ipData = await fetchJson<DnsLookupResponse>(
    "http://edns.ip-api.com/json",
    signal
  );
  const userIp = ipData?.dns?.ip;

  if (!userIp) {
    throw new Error("解析用户公网 IP 失败");
  }

  const locationData = await fetchJson<LocationApiResponse>(
    `http://ip-api.com/json/${userIp}?fields=status,message,country,regionName,city,lat,lon,timezone,query`,
    signal
  );

  if (locationData.status !== "success") {
    throw new Error(locationData.message || "无法获取用户位置");
  }

  return locationData;
  } catch {
    // Fall back to public IP geolocation providers below.
  }

  const ipInfo = await fetchJson<{
    ip?: string;
    city?: string;
    region?: string;
    country?: string;
    loc?: string;
    timezone?: string;
  }>("https://ipinfo.io/json", signal);
  const [latText, lonText] = (ipInfo.loc ?? "").split(",");
  const lat = Number(latText);
  const lon = Number(lonText);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error("无法获取用户位置：定位服务没有返回有效坐标");
  }

  return {
    status: "success",
    country: ipInfo.country,
    regionName: ipInfo.region,
    city: ipInfo.city,
    lat,
    lon,
    timezone: ipInfo.timezone,
    query: ipInfo.ip,
  };
}

function getWeatherDescription(weatherCode: number) {
  const weatherCodeMap: Record<number, string> = {
    0: "晴朗",
    1: "基本晴朗",
    2: "局部多云",
    3: "阴天",
    45: "有雾",
    48: "雾凇",
    51: "小毛毛雨",
    53: "毛毛雨",
    55: "强毛毛雨",
    61: "小雨",
    63: "中雨",
    65: "大雨",
    71: "小雪",
    73: "中雪",
    75: "大雪",
    80: "小阵雨",
    81: "中等阵雨",
    82: "强阵雨",
    95: "雷暴",
  };

  return weatherCodeMap[weatherCode] ?? "天气状况未知";
}

async function geocodeWithAmap(address: string, signal: AbortSignal) {
  const key = process.env.AMAP_WEB_SERVICE_KEY;

  if (!key) {
    throw new Error("AMAP_WEB_SERVICE_KEY 缺失");
  }

  const url = `https://restapi.amap.com/v3/geocode/geo?key=${key}&address=${encodeURIComponent(
    address
  )}`;

  const data = await fetchJson<AmapGeocodeResponse>(url, signal);

  ensureNotAborted(signal);

  if (data.status !== "1") {
    throw new Error(data.info || "高德地理编码失败");
  }

  const location = data.geocodes?.[0]?.location;

  if (!location) {
    throw new Error(`没有找到地点 "${address}" 的坐标`);
  }

  const [lngText, latText] = location.split(",");
  const lng = Number(lngText);
  const lat = Number(latText);

  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    throw new Error(`坐标格式无效: ${location}`);
  }

  return { lng, lat };
}

async function searchNearbyWithAmap(params:{
  longitude:number;
  latitude:number;
  keyword:string;
  radius?:number;
  signal:AbortSignal
}):Promise<NearbyPoi[]>{
  const key=process.env.AMAP_WEB_SERVICE_KEY;

  if(!key){
    throw new Error("AMAP_WEB_SERVICE_KEY 缺失")
  }
  const {longitude,latitude,keyword,radius=3000,signal}=params
  const url=
   `https://restapi.amap.com/v5/place/around?key=${key}` +
    `&location=${longitude},${latitude}` +
    `&keywords=${encodeURIComponent(keyword)}` +
    `&radius=${radius}` +
    `&sortrule=distance` +
    `&page_size=10`;
    const data=await fetchJson<AmapPlaceSearchResponse>(url,signal)
    ensureNotAborted(signal)
    // 检查接口状态
    if(data.status!=="1"){
      throw new Error(data.info || "高德周边搜索失败")
    }

    return (data.pois??[]).map((item)=>({
      id:item.id,
      name:item.name,
      address:item.address ?? "暂无地址",
      location:item.location,
      distance:item.distance,
      type:item.type
    }))
}

async function searchWithTavily(query: string, signal: AbortSignal) {
  // 从环境变量中取key
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error("TAVILY_API_KEY is missing in .env.local");
  }

  const response = await fetchWithTimeout(
    "https://api.tavily.com/search",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      // query表示真正问题
      body: JSON.stringify({
        query,
        topic: "general",
        search_depth: "basic",
        max_results: 5,
        include_answer: true,
      }),
    },
    signal
  );

  ensureNotAborted(signal);

  if (!response.ok) {
    throw new Error(`Tavily search failed: ${response.status}`);
  }

  const data = (await response.json()) as TavilySearchResponse;

  // 返回一个我们整理过的更干净的结构
  return {
    answer: data.answer ?? "",
    results: (data.results ?? []).map((item) => ({
      title: item.title,
      url: item.url,
      content: item.content ?? "",
      score: item.score ?? null,
    })),
  };
}

function createToolCallId(toolName: string) {
  return `${toolName}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function emitToolStart(
  onEvent: ToolEventHandler | undefined,
  toolCall: ToolCallRecord
) {
  onEvent?.({
    type: "tool-start",
    toolCall,
  });
}

function emitToolEnd(
  onEvent: ToolEventHandler | undefined,
  toolCall: ToolCallRecord
) {
  onEvent?.({
    type: "tool-end",
    toolCall,
  });
}



export function createAssistantTools(
  signal: AbortSignal,
  onEvent?: ToolEventHandler,
  mode?: "default" | "web" | "nearby"
) {
  const getUserLocation = tool({
    name: "get_user_location",
    description:
      "获取用户当前公网 IP 对应的大致地理位置。当用户询问自己在哪里、所在城市、当前位置，或后续天气和附近推荐需要位置信息时调用。",
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
    execute: async () => {
      const toolName = "get_user_location";
      const toolCallId = createToolCallId(toolName);
      const startedAt = Date.now();
      const args = {};

      emitToolStart(onEvent, {
        id: toolCallId,
        toolName,
        args,
        status: "running",
        startedAt,
      });

      try {
        ensureNotAborted(signal);

        const locationData = await getLocationFromCurrentIp(signal);

        ensureNotAborted(signal);

        if (locationData.status !== "success") {
          throw new Error(locationData.message || "无法获取用户位置");
        }

        const result = {
          country: locationData.country ?? "",
          region: locationData.regionName ?? "",
          city: locationData.city ?? "",
          lat: locationData.lat ?? null,
          lon: locationData.lon ?? null,
          timezone: locationData.timezone ?? "",
          queryIp: locationData.query ?? "",
        };

        emitToolEnd(onEvent, {
          id: toolCallId,
          toolName,
          args,
          result,
          status: "success",
          startedAt,
          finishedAt: Date.now(),
        });

        return result;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "获取位置失败";

        emitToolEnd(onEvent, {
          id: toolCallId,
          toolName,
          args,
          error: message,
          status: "error",
          startedAt,
          finishedAt: Date.now(),
        });

        throw error;
      }
    },
  });

  const getWeatherByLocation = tool({
    name: "get_weather_by_location",
    description:
      "根据用户提供的地点名称查询当前天气。当用户询问某个城市、地区或当前位置的天气时调用。参数 location 应为城市名、地区名，或由位置工具返回的城市信息。",
    parameters: z.object({
      location: z
        .string()
        .min(1, "location 不能为空")
        .describe("要查询天气的地点名称，例如 重庆、北京、Singapore"),
    }),
    execute: async ({ location }) => {
      const toolName = "get_weather_by_location";
      const toolCallId = createToolCallId(toolName);
      const startedAt = Date.now();
      const normalizedLocation = location.trim();
      const args = {
        location: normalizedLocation,
      };

      emitToolStart(onEvent, {
        id: toolCallId,
        toolName,
        args,
        status: "running",
        startedAt,
      });

      try {
        ensureNotAborted(signal);

        if (!normalizedLocation) {
          throw new Error("location 不能为空");
        }

        const amapResult = await geocodeWithAmap(normalizedLocation, signal);

        const forecastData = await fetchJson<ForecastApiResponse>(
          `https://api.open-meteo.com/v1/forecast?latitude=${
            amapResult.lat
          }&longitude=${
            amapResult.lng
          }&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&timezone=auto`,
          signal
        );

        ensureNotAborted(signal);

        const current = forecastData.current;

        if (!current) {
          throw new Error("无法获取当前天气");
        }

        const result = {
          locationName: normalizedLocation,
          time: current.time,
          temperature: current.temperature_2m,
          apparentTemperature: current.apparent_temperature,
          humidity: current.relative_humidity_2m,
          precipitation: current.precipitation,
          windSpeed: current.wind_speed_10m,
          weatherCode: current.weather_code,
          weatherDescription: getWeatherDescription(current.weather_code),
        };

        emitToolEnd(onEvent, {
          id: toolCallId,
          toolName,
          args,
          result,
          status: "success",
          startedAt,
          finishedAt: Date.now(),
        });

        return result;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "获取天气失败";

        emitToolEnd(onEvent, {
          id: toolCallId,
          toolName,
          args,
          error: message,
          status: "error",
          startedAt,
          finishedAt: Date.now(),
        });

        throw error;
      }
    },
  });
  
  const searchWeb = tool({
  name: "search_web",
  description:
    "当用户询问最新信息、新闻、官网资料、实时网页内容、某个产品或技术的当前情况时调用。输入 query 应是适合网页搜索的简洁查询语句。",
  parameters: z.object({
    query: z
      .string()
      .min(1, "query 不能为空")
      .describe("要联网搜索的问题，例如：Next.js 15 app router 最新文档"),
  }),
  execute: async ({ query }) => {
    const toolName = "search_web";
    const toolCallId = createToolCallId(toolName);
    const startedAt = Date.now();
    const normalizedQuery = query.trim();

    const args = {
      query: normalizedQuery,
    };

    emitToolStart(onEvent, {
      id: toolCallId,
      toolName,
      args,
      status: "running",
      startedAt,
    });

    try {
      ensureNotAborted(signal);

      if (!normalizedQuery) {
        throw new Error("query 不能为空");
      }

      const result = await searchWithTavily(normalizedQuery, signal);

      ensureNotAborted(signal);

      emitToolEnd(onEvent, {
        id: toolCallId,
        toolName,
        args,
        result,
        status: "success",
        startedAt,
        finishedAt: Date.now(),
      });

      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "联网搜索失败";

      emitToolEnd(onEvent, {
        id: toolCallId,
        toolName,
        args,
        error: message,
        status: "error",
        startedAt,
        finishedAt: Date.now(),
      });

      throw error;
    }
  },
});
   
  const searchNearbyPlaces=tool({
    name:"search_nearby_places",
    description: "根据用户当前位置或指定地点，搜索附近的餐厅、咖啡店、医院、景点、商场等地点。当用户询问附近有什么、周边推荐、离我最近的某类地点时调用。",
    parameters:z.object({
      keyword:z
      .string()
      .min(1,"keyword不能为空")
      .describe("要搜索的地点类型，例如 咖啡店、医院、火锅店、景点"),
      location:z
      .string()
      .optional()
      .describe("可选的地点名称。例如 重庆、解放碑、Singapore。若不传则优先结合当前位置"),
      radius:z
      .number()
      .int()
      .positive()
      .max(10000)
      .optional()
      .describe("搜索半径，单位米，默认 3000"),
    }),
    execute:async({keyword,location,radius})=>{
      const toolName="search_nearby_places";
      const toolCallId=createToolCallId(toolName);
      const startedAt=Date.now();
      const normalizedKeyword=keyword.trim()
      const normalizedLocation=location?.trim()

      const args={
        keyword:normalizedKeyword,
        location:normalizedLocation,
        radius,
      };
      emitToolStart(onEvent,{
        id:toolCallId,
        toolName,
        args,
        status:"running",
        startedAt,
      })
      try{
        ensureNotAborted(signal)
        if(!normalizedKeyword){
          throw new Error("keyword 不能为空")
        }
        let longitude:number;
        let latitude:number;
        let resolvedLocationName: string;
        if(normalizedLocation){
          const geo=await geocodeWithAmap(normalizedLocation,signal)
          longitude=geo.lng
          latitude=geo.lat
          resolvedLocationName=normalizedLocation
        }else{
          const locationData=await getLocationFromCurrentIp(signal);
        ensureNotAborted(signal)
        if(locationData.status!=="success"){
          throw new Error(locationData.message || "无法获取用户位置")
        }
        longitude=locationData.lon??NaN
        latitude=locationData.lat??NaN
        resolvedLocationName=locationData.city || locationData.regionName || locationData.country || "当前位置"
        if(!Number.isFinite(longitude)||!Number.isFinite(latitude)){
          throw new Error("当前位置坐标无效")
        }
      }
      const pois=await searchNearbyWithAmap({
        longitude,
        latitude,
        keyword:normalizedKeyword,
        radius,
        signal
      });
      const result={
        keyword:normalizedKeyword,
        locationName:resolvedLocationName,
        total:pois.length,
        pois
      };
      emitToolEnd(onEvent,{
        id:toolCallId,
        toolName,
        args,
        result,
        status:"success",
        startedAt,
        finishedAt:Date.now()
      });
      return result
      }catch(error){
        const message=error instanceof Error ? error.message :"周边搜索失败"
        emitToolEnd(onEvent,{
          id:toolCallId,
          toolName,
          args,
          error:message,
          status:"error",
          startedAt,
          finishedAt:Date.now()
        });
        throw error
      }
    }
  })

  if(mode==="web"){
     return[getUserLocation,getWeatherByLocation,searchWeb]
  }
  if(mode==="nearby"){
    return [getUserLocation,getWeatherByLocation,searchNearbyPlaces]
  }

  return [getUserLocation,getWeatherByLocation]
}
