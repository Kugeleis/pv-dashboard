import { getWeekKey } from './utils.js';

export class PVOutputAPI {
  constructor(state, i18n) {
    this.state = state;
    this.i18n = i18n;
  }

  // Fetch with timeout helper
  async fetchWithTimeout(url, options = {}, timeoutMs = 2500) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...options,
        headers: {
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Pragma": "no-cache",
          ...(options.headers || {})
        },
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      return res;
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

  // Helper to validate clean PVOutput text response
  isValidPVOutputResponse(text) {
    if (!text || typeof text !== "string") return false;
    const trimmed = text.trim();
    if (trimmed.length === 0) return false;
    if (trimmed.includes("<html") || trimmed.includes("<body") || trimmed.includes("<head")) return false;
    if (trimmed.startsWith("Err") || trimmed.startsWith("Forbidden") || trimmed.includes("Exceeded 60 requests") || trimmed.includes("error code:") || trimmed.includes("Server-side requests are not allowed")) {
      return false;
    }
    return true;
  }

  // Network Request with Multi-Proxy Fallback Chain
  async fetchPVOutput(endpoint, queryParams = {}) {
    const params = new URLSearchParams({
      sid: this.state.systemId,
      _t: Date.now().toString(),
      ...queryParams
    });

    const proxyCandidates = [];

    if (this.state.proxyUrl) {
      // Cloudflare Worker mode: the worker injects the secret API key
      // server-side, so the key never travels to or from the browser.
      const base = this.state.proxyUrl.replace(/\/+$/, "");
      proxyCandidates.push({ type: "raw", url: `${base}/${endpoint}?${params.toString()}` });
    } else {
      // Legacy mode (local dev / public proxies): the API key must travel
      // inside the target URL, because a dumb proxy only forwards it.
      const paramsWithKey = new URLSearchParams(params);
      paramsWithKey.set("key", this.state.apiKey);
      const targetUrl = `https://pvoutput.org/service/r2/${endpoint}?${paramsWithKey.toString()}`;

      proxyCandidates.push({ type: "raw", url: `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}` });
      proxyCandidates.push({ type: "raw", url: `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}` });
      proxyCandidates.push({ type: "allorigins-json", url: `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}` });
      proxyCandidates.push({ type: "raw", url: targetUrl });
    }

    let lastError = null;
    let isRateLimited = false;

    for (const proxy of proxyCandidates) {
      try {
        const res = await this.fetchWithTimeout(proxy.url, { cache: "no-store" }, 2500);
        let text = "";

        if (proxy.type === "allorigins-json") {
          if (res.ok) {
            try {
              const json = await res.json();
              text = (json && json.contents) ? json.contents.trim() : "";
            } catch (_) {}
          }
        } else {
          try {
            text = await res.text();
          } catch (_) {}
        }

        if (
          res.status === 429 ||
          (text && (
            text.includes("Exceeded 60 requests") ||
            text.includes("Rate Limit Exceeded") ||
            text.startsWith("Err 400: Exceeded") ||
            /exceeded \d+ requests/i.test(text)
          ))
        ) {
          isRateLimited = true;
        }

        if (res.ok && this.isValidPVOutputResponse(text)) {
          return text.trim();
        }
      } catch (err) {
        console.warn(`Proxy Attempt (${proxy.url}) failed:`, err);
        lastError = err;
      }
    }

    if (isRateLimited) {
      throw new Error("RATE_LIMIT_EXCEEDED");
    }

    throw lastError || new Error(`Konnte keine Verbindung zu ${endpoint} herstellen.`);
  }

  parseLiveStatus(raw) {
    const parts = raw.split(",");
    if (parts.length < 4) return null;

    return {
      date: parts[0],
      time: parts[1],
      energyWh: parseFloat(parts[2]) || 0,
      powerW: parseFloat(parts[3]) || 0,
      efficiency: parts[6] && !isNaN(parts[6]) ? parseFloat(parts[6]) : 0,
      tempC: parts[7] && !isNaN(parts[7]) ? parseFloat(parts[7]) : null
    };
  }

  parseIntradayHistory(raw) {
    const rows = raw.split(";").filter(r => r.trim());
    const points = [];

    for (const row of rows) {
      const p = row.split(",");
      if (p.length >= 5) {
        points.push({
          date: p[0],
          time: p[1],
          energyWh: parseFloat(p[2]) || 0,
          efficiency: parseFloat(p[3]) || 0,
          powerW: parseFloat(p[4]) || 0,
          tempC: p[9] && !isNaN(p[9]) ? parseFloat(p[9]) : null
        });
      }
    }

    return points.sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  }

  parseOutputRows(raw) {
    const rows = raw.split(";").filter(r => r.trim());
    const outputs = [];

    for (const row of rows) {
      const p = row.split(",");
      if (p.length >= 3) {
        outputs.push({
          dateStr: p[0],
          energyWh: parseFloat(p[1]) || 0,
          energyKwh: (parseFloat(p[1]) || 0) / 1000,
          efficiency: parseFloat(p[2]) || 0,
          peakPowerW: parseFloat(p[5]) || parseFloat(p[4]) || 0,
          peakTime: p[6] || p[5] || "",
          condition: p[7] || p[6] || ""
        });
      }
    }

    return outputs.sort((a, b) => a.dateStr.localeCompare(b.dateStr));
  }

  computeOutputAggregations(dailyRows) {
    this.state.outputData.d = dailyRows.slice(-30);

    const weeksMap = {};
    dailyRows.forEach(item => {
      const weekKey = getWeekKey(item.dateStr);
      if (!weeksMap[weekKey]) {
        weeksMap[weekKey] = { dateStr: item.dateStr, weekKey, energyKwh: 0, peakPowerW: 0, efficiencySum: 0, count: 0 };
      }
      weeksMap[weekKey].energyKwh += item.energyKwh;
      weeksMap[weekKey].peakPowerW = Math.max(weeksMap[weekKey].peakPowerW, item.peakPowerW);
      weeksMap[weekKey].efficiencySum += item.efficiency;
      weeksMap[weekKey].count += 1;
    });

    this.state.outputData.w = Object.values(weeksMap).map(w => ({
      ...w,
      efficiency: w.count > 0 ? w.efficiencySum / w.count : 0
    })).slice(-12);

    const monthsMap = {};
    dailyRows.forEach(item => {
      const monthKey = item.dateStr.substring(0, 6);
      if (!monthsMap[monthKey]) {
        monthsMap[monthKey] = { dateStr: item.dateStr, monthKey, energyKwh: 0, peakPowerW: 0, efficiencySum: 0, count: 0 };
      }
      monthsMap[monthKey].energyKwh += item.energyKwh;
      monthsMap[monthKey].peakPowerW = Math.max(monthsMap[monthKey].peakPowerW, item.peakPowerW);
      monthsMap[monthKey].efficiencySum += item.efficiency;
      monthsMap[monthKey].count += 1;
    });

    this.state.outputData.m = Object.values(monthsMap).map(m => ({
      ...m,
      efficiency: m.count > 0 ? m.efficiencySum / m.count : 0
    })).slice(-12);

    const yearsMap = {};
    dailyRows.forEach(item => {
      const yearKey = item.dateStr.substring(0, 4);
      if (!yearsMap[yearKey]) {
        yearsMap[yearKey] = { dateStr: item.dateStr, yearKey, energyKwh: 0, peakPowerW: 0, efficiencySum: 0, count: 0 };
      }
      yearsMap[yearKey].energyKwh += item.energyKwh;
      yearsMap[yearKey].peakPowerW = Math.max(yearsMap[yearKey].peakPowerW, item.peakPowerW);
      yearsMap[yearKey].efficiencySum += item.efficiency;
      yearsMap[yearKey].count += 1;
    });

    this.state.outputData.y = Object.values(yearsMap).map(y => ({
      ...y,
      efficiency: y.count > 0 ? y.efficiencySum / y.count : 0
    }));
  }

  parseStatistic(raw) {
    const p = raw.split(",");
    if (p.length < 10) return null;

    return {
      totalEnergyKwh: (parseFloat(p[0]) || 0) / 1000,
      peakPowerW: parseFloat(p[4]) || 0,
      avgDailyKwh: parseFloat(p[5]) || 0,
      maxDailyKwh: parseFloat(p[9]) || 0,
      maxDailyDate: p[10] || p[9] || "",
      outputsCount: this.state.rawDailyOutputs ? this.state.rawDailyOutputs.length : 0
    };
  }

  parseSystemInfo(raw) {
    const p = raw.split(",");
    if (p.length < 8) return null;

    return {
      name: p[0] || "--",
      capacityWp: p[1] || "--",
      panels: `${p[3] || "--"}x ${p[5] || "--"} (${p[4] || "--"} W)`,
      inverter: `${p[6] || "--"}x ${p[8] || "--"} (${p[7] || "--"} W)`,
      latitude: p.length > 13 && p[13] && p[13] !== "NaN" ? parseFloat(p[13]) : null,
      longitude: p.length > 14 && p[14] && p[14] !== "NaN" ? parseFloat(p[14]) : null
    };
  }

  // Open-Meteo API Fetcher
  async fetchOpenMeteo(lat, lng) {
    if (lat === null || lng === null) return null;

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code,is_day`;

    try {
      const res = await this.fetchWithTimeout(url, { cache: "no-store" }, 2500);
      if (res.ok) {
        const data = await res.json();
        if (data && data.current) {
          return {
            temperature_2m: data.current.temperature_2m,
            weather_code: data.current.weather_code,
            is_day: data.current.is_day
          };
        }
      }
    } catch (err) {
      console.warn("Open-Meteo Fetch Error:", err);
    }

    return null;
  }
}
