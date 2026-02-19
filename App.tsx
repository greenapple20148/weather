import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { fetchWeather, searchLocation, reverseGeocode, getWeatherDescription } from './services/weatherService';
import { getAIInsight, fetchNearbyPlacesByCategory, generatePlaceImage } from './services/geminiService';
import { WeatherData, GeocodingResult, SavedLocation, Place } from './types';
import { WeatherIconLarge } from './components/WeatherIcons';
import { Analytics } from "@vercel/analytics/react";

type Theme = 'light' | 'dark' | 'midnight';
type ChartRange = 12 | 24 | 48 | 168;

interface WeatherAlert {
  type: 'danger' | 'warning';
  title: string;
  message: string;
  icon: string;
}

interface ExplorerCategory {
  id: string;
  label: string;
  icon: string;
  places: Place[];
  loading: boolean;
}

const CACHE_KEY_WEATHER = 'skycast_weather_cache';
const CACHE_KEY_INSIGHT = 'skycast_insight_cache';
const CACHE_KEY_CONSENT = 'skycast_consent_granted';
const WEATHER_TTL = 15 * 60 * 1000;

const App = () => {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<GeocodingResult[]>([]);
  const [aiInsight, setAiInsight] = useState<string>('');
  const [isAiLoading, setIsAiLoading] = useState(false);

  const [explorerData, setExplorerData] = useState<Record<string, ExplorerCategory>>({
    malls: { id: 'malls', label: 'Shopping Malls', icon: 'fa-bag-shopping', places: [], loading: false },
    parks: { id: 'parks', label: 'Parks & Nature', icon: 'fa-tree', places: [], loading: false },
    movies: { id: 'movies', label: 'Movie Theaters', icon: 'fa-film', places: [], loading: false },
    restaurants: { id: 'restaurants', label: 'Restaurants', icon: 'fa-utensils', places: [], loading: false },
  });

  const [activeExplorerTab, setActiveExplorerTab] = useState<string>('malls');

  const [showLegal, setShowLegal] = useState(false);
  const [legalTab, setLegalTab] = useState<'terms' | 'privacy' | 'data' | 'security' | 'ip' | 'disclaimer'>('terms');
  const [chartRange, setChartRange] = useState<ChartRange>(24);
  const [showConsent, setShowConsent] = useState(() => !localStorage.getItem(CACHE_KEY_CONSENT));
  const [showLocationExplain, setShowLocationExplain] = useState(false);
  const [dismissedAlerts, setDismissedAlerts] = useState<string[]>([]);

  const [showSettings, setShowSettings] = useState(false);
  const [settingsSearch, setSettingsSearch] = useState('');
  const [settingsResults, setSettingsResults] = useState<GeocodingResult[]>([]);
  const [defaultLocation, setDefaultLocation] = useState<SavedLocation | null>(() => {
    const saved = localStorage.getItem('defaultLocation');
    return saved ? JSON.parse(saved) : null;
  });

  const [preferredCountry, setPreferredCountry] = useState<string>(() => {
    return localStorage.getItem('preferredCountry') || 'USA';
  });

  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark' || saved === 'midnight') return saved;
    return 'midnight';
  });
  const [unit, setUnit] = useState<'C' | 'F'>(() => {
    return (localStorage.getItem('tempUnit') as 'C' | 'F') || 'C';
  });

  const settingsRef = useRef<HTMLDivElement>(null);

  const formatTemp = (celsius: number) => {
    const value = unit === 'F' ? (celsius * 9) / 5 + 32 : celsius;
    return Math.round(value);
  };

  const getCache = (key: string) => {
    const item = localStorage.getItem(key);
    if (!item) return null;
    try { return JSON.parse(item); } catch { return null; }
  };

  const setCache = (key: string, data: any) => {
    localStorage.setItem(key, JSON.stringify({ data, timestamp: Date.now() }));
  };

  const isCacheValid = (timestamp: number, ttl: number) => (Date.now() - timestamp) < ttl;

  const activeAlerts = useMemo(() => {
    if (!weather) return [];
    const alerts: WeatherAlert[] = [];

    const immediateCodes = [weather.current.weatherCode, ...weather.hourly.weatherCode.slice(0, 12)];
    if (immediateCodes.some(c => c >= 95)) {
      alerts.push({
        type: 'danger',
        title: 'Neural Storm Warning',
        message: 'High-intensity electrical activity detected in immediate telemetry.',
        icon: 'fa-bolt-lightning'
      });
    } else if (immediateCodes.some(c => c === 82 || c === 86)) {
      alerts.push({
        type: 'danger',
        title: 'Critical Precipitation',
        message: 'Violent atmospheric discharge imminent. Seek shelter.',
        icon: 'fa-cloud-showers-heavy'
      });
    }

    if (weather.daily.weatherCode.slice(1).some(c => c === 65 || c === 75)) {
      alerts.push({
        type: 'warning',
        title: 'Atmospheric Escalation',
        message: 'Heavy rain or snow expected within the 7-day outlook.',
        icon: 'fa-triangle-exclamation'
      });
    }

    return alerts.filter(a => !dismissedAlerts.includes(a.title));
  }, [weather, dismissedAlerts]);

  useEffect(() => {
    if (weather) {
      const locationName = weather.location.name;
      const temp = formatTemp(weather.current.temp);
      document.title = `${locationName} Weather - ${temp}°${unit} | RZeal Weather`;
    }
  }, [weather, unit]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark', 'midnight');
    root.classList.add(theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const cycleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : (prev === 'dark' ? 'midnight' : 'light'));
  };

  const toggleUnit = () => {
    setUnit(prev => {
      const next = prev === 'C' ? 'F' : 'C';
      localStorage.setItem('tempUnit', next);
      return next;
    });
  };

  const updateCountryPreference = (country: string) => {
    setPreferredCountry(country);
    localStorage.setItem('preferredCountry', country);
    if (weather) {
      // updateAiInsight(weather, true);
      // updateActivityExplorer(weather);
    }
  };

  // const updateAiInsight = async (data: WeatherData, forceRefresh = false) => {
  //   const cached = getCache(CACHE_KEY_INSIGHT);
  //   if (!forceRefresh && cached && isCacheValid(cached.timestamp, WEATHER_TTL)) {
  //     setAiInsight(cached.data);
  //     return;
  //   }
  //   setIsAiLoading(true);
  //   const insight = await getAIInsight(data);
  //   setAiInsight(insight);
  //   setCache(CACHE_KEY_INSIGHT, insight);
  //   setIsAiLoading(false);
  // };

  const updateActivityExplorer = async (data: WeatherData) => {
    const desc = getWeatherDescription(data.current.weatherCode).text;
    const { latitude: lat, longitude: lon } = data.location;

    const categories = Object.keys(explorerData);

    setExplorerData(prev => {
      const next = { ...prev };
      categories.forEach(cat => { next[cat].loading = true; next[cat].places = []; });
      return next;
    });

    const fetchPromises = categories.map(async (catId) => {
      const places = await fetchNearbyPlacesByCategory(lat, lon, explorerData[catId].label, desc);

      setExplorerData(prev => ({
        ...prev,
        [catId]: { ...prev[catId], places, loading: false }
      }));

      const placesWithImages = [...places];
      for (let i = 0; i < placesWithImages.length; i++) {
        const img = await generatePlaceImage(placesWithImages[i].title, desc);
        if (img) {
          placesWithImages[i] = { ...placesWithImages[i], imageUrl: img };
          setExplorerData(prev => ({
            ...prev,
            [catId]: { ...prev[catId], places: [...placesWithImages] }
          }));
        }
      }
    });

    await Promise.all(fetchPromises);
  };

  const loadWeather = useCallback(async (lat: number, lon: number, name: string, country: string, forceRefresh = false) => {
    const cachedWeather = getCache(CACHE_KEY_WEATHER);
    if (!forceRefresh && cachedWeather && isCacheValid(cachedWeather.timestamp, WEATHER_TTL)) {
      const data = cachedWeather.data as WeatherData;
      if (Math.abs(data.location.latitude - lat) < 0.05 && Math.abs(data.location.longitude - lon) < 0.05) {
        setWeather(data);
        setLoading(false);
        updateAiInsight(data);
        // updateActivityExplorer(data);
        return;
      }
    }

    setLoading(true);
    setError(null);
    try {
      const data = await fetchWeather(lat, lon, name, country);
      setWeather(data);
      setCache(CACHE_KEY_WEATHER, data);
      // updateAiInsight(data, true);
      // updateActivityExplorer(data);
    } catch (err) {
      setError('Telemetry link failed. Check connection.');
    } finally {
      setLoading(false);
    }
  }, []);

  const requestGeolocation = () => {
    if (!navigator.geolocation) {
      setError('Geolocation not supported by client.');
      return;
    }
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        const info = await reverseGeocode(latitude, longitude);
        loadWeather(latitude, longitude, info.name, info.country);
        setShowLocationExplain(false);
      },
      () => {
        if (defaultLocation) {
          loadWeather(defaultLocation.latitude, defaultLocation.longitude, defaultLocation.name, defaultLocation.country);
        } else {
          setError('Location access denied. Use search or set home anchor.');
          setLoading(false);
        }
        setShowLocationExplain(false);
      }
    );
  };

  useEffect(() => {
    if (defaultLocation) {
      loadWeather(defaultLocation.latitude, defaultLocation.longitude, defaultLocation.name, defaultLocation.country);
    } else {
      const cached = getCache(CACHE_KEY_WEATHER);
      if (cached && isCacheValid(cached.timestamp, WEATHER_TTL)) {
        loadWeather(cached.data.location.latitude, cached.data.location.longitude, cached.data.location.name, cached.data.location.country);
      } else {
        setLoading(false);
      }
    }
  }, [defaultLocation, loadWeather]);

  const deleteUserData = () => {
    localStorage.clear();
    window.location.reload();
  };

  const acceptConsent = () => {
    localStorage.setItem(CACHE_KEY_CONSENT, 'true');
    setShowConsent(false);
  };

  const handleSearchChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchQuery(val);
    if (val.length > 2) {
      const results = await searchLocation(val);
      setSearchResults(results);
    } else {
      setSearchResults([]);
    }
  };

  const handleSelectLocation = (loc: GeocodingResult) => {
    setSearchQuery('');
    setSearchResults([]);
    loadWeather(loc.latitude, loc.longitude, loc.name, loc.country, true);
  };

  const handleSettingsSearchChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSettingsSearch(val);
    if (val.length > 2) {
      const results = await searchLocation(val);
      setSettingsResults(results);
    } else {
      setSettingsResults([]);
    }
  };

  const handleSetDefaultLocation = (loc: GeocodingResult) => {
    const saved: SavedLocation = { ...loc };
    setDefaultLocation(saved);
    localStorage.setItem('defaultLocation', JSON.stringify(saved));
    setSettingsSearch('');
    setSettingsResults([]);
    loadWeather(loc.latitude, loc.longitude, loc.name, loc.country, true);
    setShowSettings(false);
  };

  if (loading && !weather) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-black text-blue-500">
        <div className="w-16 h-16 border-4 border-blue-500/10 rounded-full relative">
          <div className="absolute top-0 left-0 w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        </div>
        <p className="mt-4 font-black tracking-widest uppercase text-[10px]">Syncing Atmospheric Telemetry</p>
      </div>
    );
  }

  const desc = weather ? getWeatherDescription(weather.current.weatherCode) : null;
  const isLight = theme === 'light';
  const atmosphericGradient = desc?.bg || 'from-slate-900 to-black';

  const chartData = weather ? weather.hourly.time.map((time, i) => {
    const date = new Date(time);
    return {
      time: date.getHours() + ":00",
      fullTime: date.toLocaleString('en-US', { weekday: 'short', hour: 'numeric' }),
      temp: formatTemp(weather.hourly.temperature[i]),
      precip: weather.hourly.precipitation[i],
      code: weather.hourly.weatherCode[i],
      displayTime: date.toLocaleTimeString('en-US', { hour: 'numeric' }),
      rawDate: date
    };
  }).slice(0, chartRange) : [];

  return (
    <div className={`min-h-screen relative overflow-hidden transition-all duration-1000 ${isLight ? 'text-slate-900' : 'text-white'} p-3 md:p-6`}>
      <div className={`absolute inset-0 transition-opacity duration-1000 pointer-events-none z-0 ${theme === 'midnight' ? 'opacity-100 bg-black' : 'opacity-0'}`} />
      <div className={`absolute inset-0 transition-opacity duration-1000 pointer-events-none z-0 ${isLight ? 'opacity-100 bg-slate-50' : 'opacity-0'}`} />
      <div className={`absolute inset-0 bg-gradient-to-br ${atmosphericGradient} transition-opacity duration-1000 pointer-events-none z-0`} style={{ opacity: theme === 'dark' ? 1 : 0 }} />

      <div className="max-w-[1400px] mx-auto relative z-10">
        <header className="flex flex-col sm:flex-row justify-between items-center mb-6 gap-4">
          <button
            onClick={() => setShowLocationExplain(true)}
            className="flex items-center gap-3 group focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-xl p-1"
            aria-label="Refresh current location weather"
          >
            <div className={`${!isLight ? 'bg-white/10' : 'bg-blue-600'} p-2 rounded-xl shadow-xl transition-all group-hover:scale-110`}>
              <i className="fa-solid fa-wind text-xl text-white"></i>
            </div>
            <div className="text-left">
              <h1 className="text-2xl font-black leading-none tracking-tighter">Weather Now</h1>
              <span className="text-[8px] font-black uppercase tracking-widest opacity-50">Neural Mapping Link</span>
            </div>
          </button>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            <nav className="relative flex-1 sm:w-80 group">
              <i className="fa-solid fa-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-white/30"></i>
              <input
                type="text"
                aria-label="Search city atmosphere"
                className={`w-full rounded-2xl py-2.5 pl-12 pr-6 focus:outline-none focus:ring-2 focus:ring-blue-500 ${!isLight ? 'bg-white/5 border border-white/10 text-white' : 'bg-white border border-slate-200 text-slate-900 shadow-sm'}`}
                placeholder="Query atmosphere..."
                value={searchQuery}
                onChange={handleSearchChange}
              />
              {searchResults.length > 0 && (
                <div className={`absolute top-full left-0 right-0 mt-2 rounded-xl overflow-hidden z-50 shadow-2xl ${!isLight ? 'glass-card' : 'bg-white border border-slate-100'}`}>
                  {searchResults.map((res, idx) => (
                    <button key={idx} onClick={() => handleSelectLocation(res)} className="w-full text-left px-5 py-3 border-b last:border-0 flex flex-col hover:bg-blue-500/10 focus:bg-blue-500/10 focus:outline-none">
                      <span className="font-bold text-sm">{res.name}</span>
                      <span className="text-[8px] uppercase tracking-widest opacity-50">{res.country}</span>
                    </button>
                  ))}
                </div>
              )}
            </nav>

            <div className="flex items-center gap-2">
              <button
                onClick={cycleTheme}
                className={`p-2.5 rounded-xl shadow-xl active:scale-90 focus:outline-none focus:ring-2 focus:ring-blue-500 ${!isLight ? 'bg-white/10 text-amber-400' : 'bg-white text-indigo-600'}`}
                aria-label="Switch interface theme"
              >
                <i className={`fa-solid ${theme === 'light' ? 'fa-sun' : (theme === 'dark' ? 'fa-moon' : 'fa-circle-half-stroke')} text-lg`}></i>
              </button>

              <div className="relative">
                <button
                  onClick={() => setShowSettings(!showSettings)}
                  className={`p-2.5 rounded-xl shadow-xl active:scale-90 focus:outline-none focus:ring-2 focus:ring-blue-500 ${!isLight ? 'bg-white/10 text-blue-400' : 'bg-white text-blue-600'}`}
                  aria-label="System configuration"
                >
                  <i className="fa-solid fa-gear text-lg"></i>
                </button>
                {showSettings && (
                  <div ref={settingsRef} className={`absolute top-full right-0 mt-4 w-72 md:w-80 rounded-[2rem] p-6 z-[100] shadow-2xl ${!isLight ? 'glass-card' : 'bg-white border border-slate-100'}`}>
                    <h4 className="text-xs font-black uppercase tracking-widest opacity-50 mb-4">System Config</h4>
                    <div className="space-y-6">
                      <div className="space-y-3">
                        <label className="text-[10px] font-black uppercase tracking-widest opacity-40">Country Regional Preference</label>
                        <input
                          type="text"
                          placeholder="e.g. USA, UK, France..."
                          className={`w-full rounded-xl py-2.5 px-4 text-xs focus:outline-none border ${!isLight ? 'bg-white/5 border-white/10 text-white' : 'bg-slate-50 border-slate-200 text-slate-900'}`}
                          value={preferredCountry}
                          onChange={(e) => updateCountryPreference(e.target.value)}
                        />
                      </div>

                      <div className="space-y-3">
                        <label className="text-[10px] font-black uppercase tracking-widest opacity-40">Home Anchor</label>
                        <input
                          type="text"
                          placeholder="Set default city..."
                          className={`w-full rounded-xl py-2.5 px-4 text-xs focus:outline-none border ${!isLight ? 'bg-white/5 border-white/10 text-white' : 'bg-slate-50 border-slate-200 text-slate-900'}`}
                          value={settingsSearch}
                          onChange={handleSettingsSearchChange}
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black uppercase opacity-40">Thermal Scale</span>
                        <button onClick={toggleUnit} className="px-3 py-1.5 rounded-lg font-black text-[10px] bg-blue-500/10 text-blue-500">{unit === 'C' ? 'CELSIUS' : 'FAHRENHEIT'}</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        {weather ? (
          <main className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <section className="lg:col-span-8 space-y-8">
              {activeAlerts.length > 0 && (
                <div className="space-y-3">
                  {activeAlerts.map((alert, idx) => (
                    <div key={idx} className={`relative overflow-hidden rounded-3xl p-5 flex items-center gap-5 border shadow-2xl transition-all ${alert.type === 'danger' ? 'bg-rose-500/10 border-rose-500/30 text-rose-500' : 'bg-amber-500/10 border-amber-500/30 text-amber-500'}`}>
                      <i className={`fa-solid ${alert.icon} text-xl shrink-0`}></i>
                      <div className="flex-1">
                        <h4 className="text-[11px] font-black uppercase tracking-[0.2em] mb-1">{alert.title}</h4>
                        <p className="text-xs font-bold leading-tight opacity-80">{alert.message}</p>
                      </div>
                      <button onClick={() => setDismissedAlerts(prev => [...prev, alert.title])} className="p-2 hover:bg-white/10 rounded-lg"><i className="fa-solid fa-xmark"></i></button>
                    </div>
                  ))}
                </div>
              )}

              <article className="glass-card rounded-[2.5rem] p-6 md:p-10 relative overflow-hidden">
                <div className="relative z-10 flex flex-col md:flex-row justify-between items-center gap-10">
                  <div className="space-y-6 text-center md:text-left flex-1">
                    <div className="space-y-2">
                      <h2 className="text-4xl md:text-7xl font-black tracking-tighter leading-tight">{weather.location.name}</h2>
                      <p className="text-sm md:text-base font-medium opacity-50 uppercase tracking-[0.3em]">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
                    </div>

                    <div className="flex flex-col md:flex-row items-center gap-8 md:gap-12 pt-4 justify-center md:justify-start">
                      <div className="flex flex-col items-center md:items-start">
                        <span className="text-7xl md:text-9xl font-black tracking-tighter leading-none">{formatTemp(weather.current.temp)}°</span>
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-[10px] font-black uppercase opacity-40">Feels Like</span>
                          <span className="text-lg font-black">{formatTemp(weather.current.apparentTemp)}°</span>
                        </div>
                      </div>

                      <div className="flex flex-col items-center md:items-start gap-4 border-l-0 md:border-l border-white/10 md:pl-10">
                        <div className="flex items-center gap-4">
                          <div className={`relative w-14 h-14 rounded-2xl border-2 flex items-center justify-center transition-all ${!isLight ? 'bg-white/5 border-white/10' : 'bg-white border-slate-100 shadow-sm'}`}>
                            <div className="w-full h-full absolute inset-0 flex items-center justify-center" style={{ transform: `rotate(${weather.current.windDirection}deg)` }}>
                              <div className="w-[2px] h-8 bg-blue-500 relative">
                                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 border-l-[4px] border-r-[4px] border-b-[8px] border-b-blue-500 border-transparent"></div>
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-base font-black uppercase">{weather.current.windSpeed} <small className="text-[10px] opacity-40 tracking-tight">km/h</small></span>
                            <span className="text-[9px] font-bold opacity-30 uppercase tracking-widest">Wind Telemetry</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className={`w-14 h-14 rounded-2xl border-2 flex items-center justify-center transition-all ${!isLight ? 'bg-white/5 border-white/10' : 'bg-white border-slate-100 shadow-sm'}`}>
                            <i className="fa-solid fa-droplet text-blue-400"></i>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-base font-black uppercase">{weather.current.humidity}%</span>
                            <span className="text-[9px] font-bold opacity-30 uppercase tracking-widest">Humidity</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col items-center justify-center bg-blue-500/5 p-8 rounded-[3rem] border border-blue-500/10 w-full md:w-auto min-w-[240px]">
                    <WeatherIconLarge code={weather.current.weatherCode} className={`text-7xl md:text-9xl mb-4 drop-shadow-2xl ${desc?.animate}`} />
                    <p className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-center">{desc?.text}</p>
                    <div className="mt-4 px-4 py-1.5 rounded-full bg-blue-600/20 text-blue-500 text-[10px] font-black uppercase tracking-[0.2em]">Live Stream</div>
                  </div>
                </div>
              </article>

              <section className="glass-card rounded-[2.5rem] p-8 shadow-2xl">
                <div className="flex items-center justify-between mb-10">
                  <h3 className="text-sm font-black uppercase tracking-[0.3em] opacity-40">7-Day Outlook</h3>
                  <i className="fa-solid fa-satellite text-[10px] text-blue-500 animate-pulse"></i>
                </div>
                <div className="space-y-4">
                  {weather.daily.time.map((day, idx) => {
                    const dayDesc = getWeatherDescription(weather.daily.weatherCode[idx]);
                    return (
                      <div key={idx} className="flex items-center justify-between p-4 rounded-3xl hover:bg-white/5 transition-all group cursor-default">
                        <div className="w-24">
                          <p className="text-sm font-black">{idx === 0 ? 'Today' : new Date(day).toLocaleDateString('en-US', { weekday: 'short' })}</p>
                          <div className="flex items-center gap-2 opacity-40 mt-1">
                            <span className="text-[9px] font-bold uppercase truncate tracking-tight">{dayDesc.text}</span>
                          </div>
                        </div>
                        <div className="flex-1 flex justify-center">
                          <i className={`fa-solid ${dayDesc.icon} text-2xl text-blue-500 transition-all duration-500 ${dayDesc.animate} group-hover:scale-125`}></i>
                        </div>
                        <div className="flex gap-4 min-w-[80px] justify-end">
                          <span className="text-base font-black">{formatTemp(weather.daily.tempMax[idx])}°</span>
                          <span className="text-base font-black opacity-30">{formatTemp(weather.daily.tempMin[idx])}°</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="glass-card rounded-[2.5rem] p-8 shadow-xl">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8 gap-4">
                  <h3 className="text-[10px] font-black uppercase tracking-widest opacity-40">Atmospheric Delta (Hourly)</h3>
                  <div className="flex flex-wrap gap-2">
                    {[12, 24, 48, 168].map(r => (
                      <button
                        key={r}
                        onClick={() => setChartRange(r as ChartRange)}
                        className={`px-4 py-1.5 rounded-xl text-[9px] font-black border transition-all ${chartRange === r ? 'bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-600/30' : 'opacity-40 border-white/10 hover:opacity-100'}`}
                      >
                        {r === 168 ? '7 DAYS' : (r === 48 ? '48 HOURS' : r + 'H')}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={!isLight ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.05)"} />
                      <XAxis
                        dataKey="time"
                        strokeOpacity={0.4}
                        fontSize={8}
                        fontWeight={900}
                        interval={chartRange > 48 ? 23 : (chartRange > 24 ? 5 : 1)}
                        tickFormatter={(val, i) => {
                          if (chartRange <= 24) return val;
                          const item = chartData[i];
                          if (!item) return val;
                          const hour = item.rawDate.getHours();
                          if (hour === 0) return item.rawDate.toLocaleDateString('en-US', { weekday: 'short' });
                          return val;
                        }}
                      />
                      <YAxis hide domain={['dataMin - 2', 'dataMax + 2']} />
                      <Tooltip
                        contentStyle={{ borderRadius: '1.5rem', border: 'none', background: 'rgba(0,0,0,0.85)', color: 'white', backdropFilter: 'blur(10px)' }}
                        labelFormatter={(val, items) => {
                          if (items && items[0]) {
                            return items[0].payload.fullTime;
                          }
                          return val;
                        }}
                      />
                      <Area type="monotone" dataKey="temp" stroke="#3b82f6" strokeWidth={4} fillOpacity={0.3} fill="#3b82f6" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </section>

            </section>

            <aside className="lg:col-span-4 h-full">
              {/* Baby Sale Card */}
              <section className="glass-card rounded-[2.5rem] p-8 shadow-2xl border border-blue-400/20 bg-gradient-to-br from-blue-400/5 to-transparent">
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-12 h-12 rounded-2xl bg-blue-400 flex items-center justify-center shadow-lg shadow-blue-400/20">
                    <i className="fa-solid fa-baby-carriage text-2xl text-white"></i>
                  </div>
                  <div>
                    <h3 className="text-sm font-black uppercase tracking-widest text-blue-400">Essential Savings</h3>
                    <span className="text-[9px] font-bold opacity-40 uppercase tracking-tighter">Amazon Baby Sale</span>
                  </div>
                </div>

                <p className="text-xs font-medium leading-relaxed opacity-70 mb-8 uppercase tracking-wide">
                  Equip your nursery with premium atmospheric comfort. Discover major discounts on baby essentials and gear.
                </p>

                <a
                  href="https://www.amazon.com/baby-reg/homepage?ref=CG_ac_banner_020226_Announcement_BABYSALE"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center justify-between w-full py-4 px-6 rounded-2xl bg-blue-500 text-white font-black uppercase text-[10px] transition-all hover:bg-blue-400 shadow-xl shadow-blue-500/20"
                >
                  <span>Shop Baby Sale at Amazon</span>
                  <i className="fa-solid fa-arrow-up-right-from-square transition-transform group-hover:translate-x-1 group-hover:-translate-y-1"></i>
                </a>


              </section>

              {/* Trending Now / Wedding Registry Card */}
              <section className="glass-card rounded-[2.5rem] p-8 mt-6 shadow-2xl border border-indigo-400/20 bg-gradient-to-br from-indigo-400/5 to-transparent">
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                    <i className="fa-solid fa-gift text-2xl text-white"></i>
                  </div>
                  <div>
                    <h3 className="text-sm font-black uppercase tracking-widest text-indigo-400">Trending Now</h3>
                    <span className="text-[9px] font-bold opacity-40 uppercase tracking-tighter">Wedding Registry</span>
                  </div>
                </div>

                <p className="text-xs font-medium leading-relaxed opacity-70 mb-8 uppercase tracking-wide">
                  Celebrate new beginnings. Start your wedding registry and discover trending gifts for every atmospheric setting.
                </p>

                <a
                  href="https://www.amazon.com/registries/gl/create?registryType=wedding&ref_=hit_wr_cr_or"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center justify-between w-full py-4 px-6 rounded-2xl bg-indigo-600 text-white font-black uppercase text-[10px] transition-all hover:bg-indigo-500 shadow-xl shadow-indigo-600/20"
                >
                  <span>Create Registry at Amazon</span>
                  <i className="fa-solid fa-arrow-up-right-from-square transition-transform group-hover:translate-x-1 group-hover:-translate-y-1"></i>
                </a>
              </section>

              {/* Wedding Registry Card */}
              <section className="glass-card rounded-[2.5rem] p-8 mt-6 shadow-2xl border border-rose-400/20 bg-gradient-to-br from-rose-400/5 to-transparent">
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-12 h-12 rounded-2xl bg-rose-500 flex items-center justify-center shadow-lg shadow-rose-500/20">
                    <i className="fa-solid fa-rings-wedding text-2xl text-white"></i>
                  </div>
                  <div>
                    <h3 className="text-sm font-black uppercase tracking-widest text-rose-400">Wedding Registry</h3>
                    <span className="text-[9px] font-bold opacity-40 uppercase tracking-tighter">Amazon Services</span>
                  </div>
                </div>

                <p className="text-xs font-medium leading-relaxed opacity-70 mb-8 uppercase tracking-wide">
                  Share the love with friends and family. Create your Amazon Wedding Registry and enjoy exclusive rewards and benefits.
                </p>

                <a
                  href="https://amzn.to/46U6V5Z"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center justify-between w-full py-4 px-6 rounded-2xl bg-rose-600 text-white font-black uppercase text-[10px] transition-all hover:bg-rose-500 shadow-xl shadow-rose-600/20"
                >
                  <span>Get Started at Amazon</span>
                  <i className="fa-solid fa-arrow-up-right-from-square transition-transform group-hover:translate-x-1 group-hover:-translate-y-1"></i>
                </a>
              </section>

              {/* Fresh Grocery Card */}
              <section className="glass-card rounded-[2.5rem] p-8 mt-6 shadow-2xl border border-emerald-400/20 bg-gradient-to-br from-emerald-400/5 to-transparent">
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                    <i className="fa-solid fa-basket-shopping text-2xl text-white"></i>
                  </div>
                  <div>
                    <h3 className="text-sm font-black uppercase tracking-widest text-emerald-400">Fresh Grocery</h3>
                    <span className="text-[9px] font-bold opacity-40 uppercase tracking-tighter">Amazon Fresh</span>
                  </div>
                </div>

                <p className="text-xs font-medium leading-relaxed opacity-70 mb-8 uppercase tracking-wide">
                  Stay fueled with the freshest ingredients. Get high-quality groceries delivered directly to your doorstep.
                </p>

                <a
                  href="https://amzn.to/4kI8F8c"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center justify-between w-full py-4 px-6 rounded-2xl bg-emerald-600 text-white font-black uppercase text-[10px] transition-all hover:bg-emerald-500 shadow-xl shadow-emerald-600/20"
                >
                  <span>Shop Fresh at Amazon</span>
                  <i className="fa-solid fa-arrow-up-right-from-square transition-transform group-hover:translate-x-1 group-hover:-translate-y-1"></i>
                </a>
              </section>

              {/* Amazon Music Card */}
              <section className="glass-card rounded-[2.5rem] p-8 mt-6 shadow-2xl border border-blue-400/20 bg-gradient-to-br from-blue-400/5 to-transparent">
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-12 h-12 rounded-2xl bg-blue-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
                    <i className="fa-solid fa-music text-2xl text-white"></i>
                  </div>
                  <div>
                    <h3 className="text-sm font-black uppercase tracking-widest text-blue-400">Stream Anywhere</h3>
                    <span className="text-[9px] font-bold opacity-40 uppercase tracking-tighter">Amazon Music</span>
                  </div>
                </div>

                <p className="text-xs font-medium leading-relaxed opacity-70 mb-8 uppercase tracking-wide">
                  Set the mood for every forecast. Access millions of songs and podcasts with the ultimate atmospheric soundtrack.
                </p>

                <a
                  href="https://amzn.to/4kI7vtj"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center justify-between w-full py-4 px-6 rounded-2xl bg-blue-600 text-white font-black uppercase text-[10px] transition-all hover:bg-blue-500 shadow-xl shadow-blue-600/20"
                >
                  <span>Listen Now at Amazon</span>
                  <i className="fa-solid fa-arrow-up-right-from-square transition-transform group-hover:translate-x-1 group-hover:-translate-y-1"></i>
                </a>


              </section>
            </aside>
          </main>
        ) : (
          <div className="text-center py-40 opacity-20"><p className="text-xl font-black uppercase tracking-[0.5em]">Establishing Connection...</p></div>
        )}
      </div>

      <footer className="max-w-7xl mx-auto mt-24 mb-12 text-center border-t border-white/5 pt-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 mb-12 text-left px-8">
          <div className="space-y-4">
            <h5 className="text-[10px] font-black uppercase tracking-widest text-blue-500">RZeal Neural Core</h5>
            <p className="text-[11px] leading-relaxed opacity-40 font-bold uppercase">
              Atmospheric data by <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer" className="hover:text-blue-500 underline">Open-Meteo</a>.
              Service by <span className="text-blue-400">RZeal Solutions LLC</span>.
            </p>
          </div>
          <div className="space-y-4">
            <h5 className="text-[10px] font-black uppercase tracking-widest text-blue-500">Intelligence Layers</h5>
            <p className="text-[11px] leading-relaxed opacity-40 font-bold uppercase">
              Venue grounding via Google Maps. Logic rendered via Gemini Multi-modal Engines.
            </p>
          </div>
          <div className="space-y-4">
            <h5 className="text-[10px] font-black uppercase tracking-widest text-blue-500">Legal Architecture</h5>
            <nav className="flex flex-col gap-2">
              <button onClick={() => { setLegalTab('privacy'); setShowLegal(true); }} className="text-[10px] text-left opacity-40 hover:opacity-100 font-bold uppercase">Privacy Policy</button>
              <button onClick={() => { setLegalTab('terms'); setShowLegal(true); }} className="text-[10px] text-left opacity-40 hover:opacity-100 font-bold uppercase">Terms of Service</button>
              <button onClick={() => { setLegalTab('disclaimer'); setShowLegal(true); }} className="text-[10px] text-left opacity-40 hover:opacity-100 font-bold uppercase text-blue-500">Disclaimer</button>
            </nav>
          </div>
        </div>

        <div className="max-w-4xl mx-auto mb-12 px-8">
          <div className="py-6 px-10 rounded-[2rem] bg-amber-500/5 border border-amber-500/10">
            <p className="text-[11px] leading-relaxed opacity-60 font-black uppercase tracking-widest text-center text-amber-500/80">
              <i className="fa-solid fa-circle-info mr-2"></i>
              Affiliate Disclosure: We are a participant in the Amazon Services LLC Associates Program, an affiliate advertising program designed to provide a means for us to earn fees by linking to Amazon.com and affiliated sites.
            </p>
          </div>
        </div>

        <div className="inline-flex items-center gap-6 py-3 px-8 rounded-full text-[9px] font-black uppercase tracking-widest bg-black/40 border border-white/5 text-white/40">
          <span>RZeal Solutions LLC v1.5.0</span>
          <div className="w-[1px] h-3 bg-white/10"></div>
          <span>Engineering Atmospheric Certainty</span>
        </div>
      </footer>

      {
        showLegal && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={() => setShowLegal(false)}></div>
            <div className={`relative w-full max-w-4xl glass-card rounded-[3rem] shadow-2xl h-[80vh] flex flex-col md:flex-row overflow-hidden border border-white/10 ${theme === 'midnight' ? 'bg-black' : 'bg-slate-900'}`}>
              <div className="w-full md:w-64 border-b md:border-b-0 md:border-r border-white/10 p-8 flex flex-col gap-3 shrink-0">
                <h2 className="text-[11px] font-black uppercase tracking-[0.2em] text-blue-500 mb-8 flex items-center gap-3">
                  <i className="fa-solid fa-shield-check"></i> Compliance Hub
                </h2>
                {['privacy', 'terms', 'disclaimer', 'security', 'ip', 'data'].map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setLegalTab(tab as any)}
                    className={`text-[10px] font-black uppercase tracking-widest text-left px-5 py-4 rounded-2xl transition-all ${legalTab === tab ? 'bg-blue-600 text-white shadow-xl shadow-blue-600/20' : 'opacity-40 hover:bg-white/5 hover:opacity-100'}`}
                  >
                    {tab === 'ip' ? 'Intellectual Property' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>

              <div className="flex-1 flex flex-col min-w-0">
                <div className="flex-1 overflow-y-auto p-12 pr-16 no-scrollbar text-sm opacity-80 leading-relaxed space-y-8">
                  {legalTab === 'privacy' && (
                    <div className="space-y-6">
                      <h3 className="text-lg font-black text-blue-500 uppercase">📜 Privacy Policy</h3>
                      <p className="text-[10px] font-bold opacity-40 uppercase">Last Updated: October 2024</p>
                      <p className="font-bold">This website is operated by RZeal Solutions LLC, a Virginia limited liability company.</p>
                      <p>RZeal Solutions LLC (“we,” “us,” or “our”) respects your privacy. This policy explains how we collect, use, store, and share information when you visit or interact with our Service.</p>

                      <section>
                        <h4 className="font-black text-xs uppercase mb-2">Information We Collect</h4>
                        <h5 className="font-bold text-[11px] opacity-70">1) Information you provide directly</h5>
                        <ul className="list-disc pl-5 mb-3 opacity-80">
                          <li>Location data you choose to share (to provide localized forecasts)</li>
                        </ul>
                        <h5 className="font-bold text-[11px] opacity-70">2) Automatic & technical data</h5>
                        <ul className="list-disc pl-5 opacity-80">
                          <li>IP address</li>
                          <li>Device/browser type</li>
                          <li>Usage analytics (pages viewed, interaction timing)</li>
                        </ul>
                      </section>

                      <section>
                        <h4 className="font-black text-xs uppercase mb-2">How We Use Information</h4>
                        <p className="mb-2">We use the information to:</p>
                        <ul className="list-disc pl-5 opacity-80">
                          <li>Provide accurate weather forecasts and alerts</li>
                          <li>Improve and personalize the Service</li>
                          <li>Communicate important updates or changes</li>
                          <li>Analyze usage trends for product improvement</li>
                        </ul>
                      </section>

                      <section>
                        <h4 className="font-black text-xs uppercase mb-2">Location Data</h4>
                        <p>If you opt-in to share precise location, we use it to deliver localized weather information. You may revoke this permission at any time via your device or browser settings.</p>
                      </section>

                      <section>
                        <h4 className="font-black text-xs uppercase mb-2">Cookies & Tracking</h4>
                        <p className="mb-2">We may use cookies or similar technologies to:</p>
                        <ul className="list-disc pl-5 opacity-80">
                          <li>Remember preferences</li>
                          <li>Analyze site traffic</li>
                          <li>Optimize performance</li>
                        </ul>
                        <p className="mt-2">You can manage cookies via your browser settings.</p>
                      </section>

                      <section>
                        <h4 className="font-black text-xs uppercase mb-2">Third-Party Services</h4>
                        <p>We may use third-party analytics and data providers. These parties have their own privacy policies.</p>
                      </section>

                      <section>
                        <h4 className="font-black text-xs uppercase mb-2">Security</h4>
                        <p>We implement reasonable safeguards to protect data but cannot guarantee security against all threats.</p>
                      </section>

                      <section>
                        <h4 className="font-black text-xs uppercase mb-2">Your Rights</h4>
                        <p className="mb-2">Depending on your jurisdiction, you may have rights to:</p>
                        <ul className="list-disc pl-5 opacity-80">
                          <li>Access your data</li>
                          <li>Correct or delete your information</li>
                          <li>Restrict or object to processing</li>
                        </ul>
                        <p className="mt-2">Contact us at <span className="text-blue-500">support@rzealsolutions.com</span> for requests.</p>
                      </section>
                    </div>
                  )}

                  {legalTab === 'terms' && (
                    <div className="space-y-6">
                      <h3 className="text-lg font-black text-blue-500 uppercase">📑 Terms of Service</h3>
                      <p className="text-[10px] font-bold opacity-40 uppercase">Effective Date: October 2024</p>
                      <p className="font-bold">This website is operated by RZeal Solutions LLC, a Virginia limited liability company.</p>
                      <p>By accessing or using RZeal Solutions LLC services, you agree to the following terms. If you do not agree, please do not use the Service.</p>

                      <section>
                        <h4 className="font-black text-xs uppercase mb-2">Eligibility & Geographic Restriction</h4>
                        <p className="mb-2">You must be at least 13 years old to use the Service. By using the Service, you represent that you meet this requirement.</p>
                        <p className="font-bold text-rose-500">This Service is designed and intended for use only within the United States of America (USA). We do not guarantee that the Service or its content is appropriate or available for use in other locations. Accessing the Service from territories where its content is illegal is prohibited.</p>
                      </section>

                      <section>
                        <h4 className="font-black text-xs uppercase mb-2">Use of the Service</h4>
                        <p className="mb-2 font-bold opacity-70">You agree to:</p>
                        <ul className="list-disc pl-5 mb-3 opacity-80">
                          <li>Use the Service for lawful purposes</li>
                          <li>Provide accurate information when requested</li>
                          <li>Respect intellectual property rights</li>
                        </ul>
                      </section>

                      <section>
                        <h4 className="font-black text-xs uppercase mb-2">Weather Data and Accuracy</h4>
                        <p>All weather forecasts and related content are provided “as-is.” We do not guarantee accuracy, completeness, or fitness for any particular purpose.</p>
                      </section>

                      <section>
                        <h4 className="font-black text-xs uppercase mb-2">Content Ownership</h4>
                        <p>RZeal Solutions LLC and its licensors retain all rights, title, and interest in the Service, including all content, software, and trademarks. You may not copy, distribute, modify, or create derivative works based on the Service without permission.</p>
                      </section>

                      <section>
                        <h4 className="font-black text-xs uppercase mb-2">Liability Limitation</h4>
                        <p className="mb-2">To the fullest extent permitted by law, RZeal Solutions LLC is not liable for:</p>
                        <ul className="list-disc pl-5 opacity-80">
                          <li>Direct, indirect, incidental, or consequential damages</li>
                          <li>Losses arising from use or inability to use the Service</li>
                          <li>Weather-related damages or decisions based on forecasts</li>
                        </ul>
                        <p className="mt-2 italic">Your sole remedy is to discontinue use of the Service.</p>
                      </section>

                      <section>
                        <h4 className="font-black text-xs uppercase mb-2">Changes to Terms</h4>
                        <p>We may update these Terms at any time. Continued use of the Service after changes constitutes acceptance of the updated Terms.</p>
                      </section>

                      <section>
                        <h4 className="font-black text-xs uppercase mb-2">Governing Law</h4>
                        <p>These Terms are governed by the laws of the State of Virginia and the United States without regard to conflict of law principles.</p>
                      </section>

                      <section>
                        <h4 className="font-black text-xs uppercase mb-2">Contact</h4>
                        <p>For questions about these Terms, email: <span className="text-blue-500">support@rzealsolutions.com</span></p>
                      </section>
                    </div>
                  )}

                  {legalTab === 'disclaimer' && (
                    <div className="space-y-8">
                      <h3 className="text-lg font-black text-blue-500 uppercase">📄 Disclaimer</h3>
                      <p className="font-bold">This website is operated by RZeal Solutions LLC, a Virginia limited liability company.</p>

                      <section>
                        <h4 className="font-black text-xs uppercase mb-2">Weather Information Disclaimer</h4>
                        <p className="mb-4">All weather forecasts, alerts, conditions, and related content provided on RZeal Solutions LLC (the “Service”) are for general informational purposes only.</p>
                        <p className="mb-4">While we strive for accuracy, weather data is inherently uncertain and may change rapidly. You should not rely solely on the information provided for making life, health, safety, or emergency decisions.</p>
                        <p className="mb-2 font-bold opacity-70">RZeal Solutions LLC and its partners do not guarantee:</p>
                        <ul className="list-disc pl-5 opacity-80">
                          <li>Complete accuracy of forecasts or alerts</li>
                          <li>Timeliness or reliability of weather information</li>
                          <li>That use of the Service will prevent injury or property loss</li>
                        </ul>
                        <p className="mt-4 font-black text-[11px] uppercase text-rose-500">You assume all risk associated with using weather information from this Service.</p>
                      </section>

                      <section>
                        <h4 className="font-black text-xs uppercase mb-2">General Disclaimer & Geographic Limitation</h4>
                        <h5 className="font-bold text-[11px] opacity-70 mb-1">USA Use Only</h5>
                        <p className="mb-4 font-bold">This Service is intended for use only within the United States of America (USA). We make no representations that the content or Service is appropriate for use in other locations.</p>
                        <h5 className="font-bold text-[11px] opacity-70 mb-1">Informational Purposes Only</h5>
                        <p className="mb-4">The information provided on this platform is for general informational and educational purposes only. It does not constitute financial, investment, legal, or tax advice.</p>
                        <p className="mb-4">You should not rely on the information on this website as a substitute for professional advice tailored to your individual circumstances. Always consult a qualified professional before making financial decisions.</p>
                      </section>


                      <section>
                        <h4 className="font-black text-xs uppercase mb-2">No Guarantees</h4>
                        <p className="mb-2">We do not guarantee:</p>
                        <ul className="space-y-1 mb-4 opacity-70 italic">
                          <li>• savings outcomes</li>
                          <li>• debt reduction</li>
                          <li>• financial performance</li>
                          <li>• accuracy of predictions or projections</li>
                        </ul>
                        <p>Past performance and simulations do not guarantee future results.</p>
                      </section>
                    </div>
                  )}

                  {legalTab === 'security' && (
                    <section><h3 className="text-xs font-black text-blue-500 uppercase mb-4">Security Architecture</h3><p>Telemetry links are secured via TLS 1.3 encryption. Internal data flows are isolated and audited for security compliance. Managed by RZeal Solutions LLC.</p></section>
                  )}

                  {legalTab === 'ip' && (
                    <section><h3 className="text-xs font-black text-blue-500 uppercase mb-4">Intellectual Property</h3><p>Interface designs, AI models, and regional telemetry logic are the proprietary property of RZeal Solutions LLC. Attribution required for third-party weather data sources.</p></section>
                  )}

                  {legalTab === 'data' && (
                    <div className="space-y-6">
                      <h3 className="text-xs font-black text-blue-500 uppercase">Data Sovereignty</h3>
                      <p>Manage your local footprint. Purging data will reset your preferred country, default location, and thermal units.</p>
                      <button onClick={deleteUserData} className="w-full py-6 rounded-[2.5rem] bg-rose-600 text-white font-black uppercase text-[11px] hover:bg-rose-500 transition-all shadow-xl shadow-rose-600/20">Purge Device Profile & Local Data</button>
                    </div>
                  )}
                </div>
                <div className="p-8 border-t border-white/10 shrink-0">
                  <button onClick={() => setShowLegal(false)} className="w-full py-5 rounded-[2rem] bg-blue-600 text-white font-black uppercase text-[11px] shadow-2xl">Return to Forecast</button>
                </div>
              </div>
            </div>
          </div>
        )
      }

      {
        showConsent && (
          <div className="fixed bottom-8 left-8 right-8 z-[300] sm:max-w-md">
            <div className="glass-card p-8 rounded-[2rem] border-blue-500/30 shadow-2xl bg-slate-950 flex flex-col gap-5 border">
              <div className="flex items-center gap-4">
                <i className="fa-solid fa-cookie-bite text-3xl text-amber-500"></i>
                <h4 className="text-[11px] font-black uppercase tracking-widest">Atmospheric Consent</h4>
              </div>
              <p className="text-[12px] opacity-70 leading-relaxed">RZeal Solutions LLC uses local persistence to sync preferences. By continuing, you acknowledge our <button onClick={() => { setLegalTab('disclaimer'); setShowLegal(true); }} className="text-blue-400 underline decoration-dotted">Disclaimer</button>, <button onClick={() => { setLegalTab('privacy'); setShowLegal(true); }} className="text-blue-400 underline decoration-dotted">Privacy Policy</button>, and <button onClick={() => { setLegalTab('terms'); setShowLegal(true); }} className="text-blue-400 underline decoration-dotted">Terms of Service</button>. Intended for use only within the USA.</p>
              <div className="flex gap-3">
                <button onClick={acceptConsent} className="flex-1 py-4 rounded-2xl bg-blue-600 text-white font-black uppercase text-[10px] shadow-xl shadow-blue-600/20">Acknowledge</button>
                <button onClick={() => setShowConsent(false)} className="px-6 py-4 rounded-2xl bg-white/5 font-black uppercase text-[10px]">Later</button>
              </div>
            </div>
          </div>
        )
      }

      {
        showLocationExplain && (
          <div className="fixed inset-0 z-[250] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/80" onClick={() => setShowLocationExplain(false)}></div>
            <div className="relative w-full max-sm glass-card p-8 rounded-[2.5rem] bg-slate-900 shadow-2xl text-center border border-white/5">
              <i className="fa-solid fa-location-dot text-4xl text-blue-500 mb-6 drop-shadow-lg"></i>
              <h4 className="text-sm font-black uppercase tracking-widest mb-4">Precision Telemetry</h4>
              <p className="text-xs opacity-60 leading-relaxed mb-8">Accessing your GPS allows us to provide micro-climate data. Your coordinates are transmitted securely and never stored. Service operated by RZeal Solutions LLC and restricted to USA territories.</p>
              <div className="flex flex-col gap-3">
                <button onClick={requestGeolocation} className="w-full py-4 rounded-2xl bg-blue-600 text-white font-black uppercase text-[10px] shadow-lg shadow-blue-600/20">Allow Precision Sync</button>
                <button onClick={() => setShowLocationExplain(false)} className="w-full py-4 rounded-2xl bg-white/5 font-black uppercase text-[10px]">Manual Search</button>
              </div>
            </div>
          </div>
        )
      }

      <Analytics />
    </div >
  );
};

export default App;
