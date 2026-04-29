import { useState, useEffect } from 'react';
import axios from 'axios';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ReferenceArea, ResponsiveContainer } from 'recharts';

export default function App() {
  const [activeTab, setActiveTab] = useState('interval');
  const [mode, setMode] = useState('mean');

  // Unified State
  const [rawDataStr, setRawDataStr] = useState('');
  const [n, setN] = useState(32);
  const [mean, setMean] = useState(8.2);
  const [stdDev, setStdDev] = useState(0.6);
  const [sampleVariance, setSampleVariance] = useState(0.36);
  const [isSigmaKnown, setIsSigmaKnown] = useState(false);
  const [successes, setSuccesses] = useState(24);
  
  const [confLevel, setConfLevel] = useState(95);
  const [alpha, setAlpha] = useState(0.05);
  const [h0, setH0] = useState(8.0);
  const [h1Type, setH1Type] = useState('two');
  const [marginError, setMarginError] = useState(0.05);

  const [resultData, setResultData] = useState(null);
  const [inputError, setInputError] = useState(null);


  const handleCalculate = async () => {
    let rawData = null;
    if (rawDataStr.trim()) {
      rawData = rawDataStr.split(/[\s,]+/).map(Number).filter(num => !isNaN(num));
      if (rawData.length < 2) rawData = null;
    }

    // Validation
    if (!rawData) {
      if (activeTab !== 'samplesize' && n < 2) return setInputError("Sample size (n) must be ≥ 2.");
      if (mode === 'mean' && stdDev <= 0) return setInputError("Standard deviation must be > 0.");
      if (mode === 'variance' && sampleVariance <= 0) return setInputError("Variance must be > 0.");
      if (mode === 'proportion' && (successes < 0 || successes > n)) return setInputError("Successes must be between 0 and n.");
    }
    setInputError(null);

    try {
      const response = await axios.post('http://localhost:8000/calculate', {
        calcType: activeTab, mode, confLevel: Number(confLevel), alpha: Number(alpha),
        n: Number(n), mean: Number(mean), stdDev: Number(stdDev), sampleVariance: Number(sampleVariance), 
        isSigmaKnown, successes: Number(successes), h0: Number(h0), h1Type, marginError: Number(marginError), rawData
      });
      setResultData(response.data);
    } catch (error) {
      console.error(error);
      setInputError("Error connecting to Python Engine. Is uvicorn running?");
    }
  };

    // Auto-Calculate Hook
  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      handleCalculate();
    }, 400); 
    return () => clearTimeout(delayDebounceFn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, mode, rawDataStr, n, mean, stdDev, sampleVariance, isSigmaKnown, successes, h0, h1Type, confLevel, alpha, marginError]);

  // Mathematically map the tails so they only shade strictly under the curve
  const chartDataWithTails = resultData?.chartData?.map(point => {
    let isTail = false;
    const cv = resultData.criticalValues;
    if (cv?.length === 2) {
      if (point.x <= cv[0] || point.x >= cv[1]) isTail = true;
    } else if (cv?.length === 1) {
      if (h1Type === 'left' && point.x <= cv[0]) isTail = true;
      if (h1Type === 'right' && point.x >= cv[0]) isTail = true;
    }
    return { ...point, 
      yTail: isTail ? point.y : 0,
      yAccept: !isTail ? point.y : 0
    };
  });

// Helper function to mathematically interpolate the exact height of the curve
  const getCurveHeight = (targetX) => {
    if (!chartDataWithTails || chartDataWithTails.length === 0) return 0;
    
    // Find the peak of the curve to calculate a 5% minimum stub height
    const maxPeak = Math.max(...chartDataWithTails.map(d => d.y));
    const minHeight = maxPeak * 0.05; 

    let exactHeight = 0;

    if (targetX <= chartDataWithTails[0].x) {
      exactHeight = chartDataWithTails[0].y;
    } else if (targetX >= chartDataWithTails[chartDataWithTails.length - 1].x) {
      exactHeight = chartDataWithTails[chartDataWithTails.length - 1].y;
    } else {
      for (let i = 0; i < chartDataWithTails.length - 1; i++) {
        if (targetX >= chartDataWithTails[i].x && targetX <= chartDataWithTails[i+1].x) {
          const p1 = chartDataWithTails[i];
          const p2 = chartDataWithTails[i+1];
          const slope = (p2.y - p1.y) / (p2.x - p1.x);
          exactHeight = p1.y + slope * (targetX - p1.x);
          break;
        }
      }
    }
    
    // Return whichever is taller: the actual curve, or the tiny 5% stub!
    return Math.max(exactHeight, minHeight);
  };
  
  // Calculate if the chart is zoomed out so far that the critical values are squished
  const xMin = chartDataWithTails?.[0]?.x || -4;
  const xMax = chartDataWithTails?.[chartDataWithTails.length - 1]?.x || 4;
  const domainWidth = xMax - xMin;
  
  // If the distance between the two critical values is less than 15% of the screen, stagger them!
  const areCritsClose = resultData?.criticalValues?.length === 2 && 
                        ((resultData.criticalValues[1] - resultData.criticalValues[0]) / domainWidth) < 0.15;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 p-6 font-sans text-slate-800">
      <div className="max-w-6xl mx-auto">
        
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600 mb-2 py-1">
            Statistical Engine Pro
          </h1>
          <p className="text-lg font-medium text-slate-500">Lectures 4 • 5 • 6 • 7 — Dr. Mohamed E. Sobh</p>
        </div>

        {/* Top Navigation */}
        <div className="flex flex-wrap justify-center gap-2 mb-8">
          {[
            { id: 'interval', label: '1. Confidence Intervals' },
            { id: 'hypothesis', label: '2. Hypothesis Testing' },
            { id: 'samplesize', label: '3. Sample Size Calc (n)' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setResultData(null); }}
              className={`px-6 py-3 rounded-xl font-bold transition-all duration-200 ${
                activeTab === tab.id ? 'bg-blue-600 text-white shadow-lg shadow-blue-200 scale-105' : 'bg-white text-slate-500 hover:bg-slate-100 shadow-sm'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* LEFT PANEL: Inputs */}
          <div className="lg:col-span-4 bg-white rounded-3xl shadow-xl p-6 border border-slate-100 h-fit">
            
            {/* Parameter Selector */}
            {activeTab !== 'samplesize' && (
              <div className="mb-6 bg-slate-50 p-2 rounded-xl flex gap-1">
                {['mean', 'proportion', 'variance'].map(p => (
                  <button key={p} onClick={() => setMode(p)} className={`flex-1 py-2 text-sm font-bold rounded-lg capitalize transition-all ${mode === p ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                    {p}
                  </button>
                ))}
              </div>
            )}

            <div className="space-y-5">
              {/* Raw Data Input (Only for Mean/Variance) */}
              {(mode === 'mean' || mode === 'variance') && activeTab !== 'samplesize' && (
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Raw Data Array (Optional)</label>
                  <textarea 
                    value={rawDataStr} onChange={e => setRawDataStr(e.target.value)} 
                    placeholder="Paste numbers separated by spaces or commas..."
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none text-sm resize-none h-20"
                  />
                </div>
              )}

              {/* Standard Inputs (Hidden if Raw Data is used) */}
              {!rawDataStr.trim() && (
                <div className="space-y-4">
                  {activeTab !== 'samplesize' && (
                    <div>
                      <label className="block text-sm font-bold text-slate-700 mb-1">Sample Size (n)</label>
                      <input type="number" value={n} onChange={e => setN(e.target.value)} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                  )}

                  {mode === 'mean' && (
                    <>
                      {activeTab !== 'samplesize' && (
                        <div>
                          <label className="block text-sm font-bold text-slate-700 mb-1">Sample Mean (x̄)</label>
                          <input type="number" step="0.01" value={mean} onChange={e => setMean(e.target.value)} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
                        </div>
                      )}
                      <div>
                        <label className="block text-sm font-bold text-slate-700 mb-1">Std Deviation (σ or S)</label>
                        <input type="number" step="0.01" value={stdDev} onChange={e => setStdDev(e.target.value)} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
                      </div>
                      {activeTab !== 'samplesize' && (
                        <div className="flex items-center pt-1">
                          <input type="checkbox" checked={isSigmaKnown} onChange={e => setIsSigmaKnown(e.target.checked)} className="w-4 h-4 text-blue-600 rounded" />
                          <label className="ml-2 text-sm font-bold text-slate-600">Pop. Variance (σ²) Known?</label>
                        </div>
                      )}
                    </>
                  )}

                  {mode === 'variance' && activeTab !== 'samplesize' && (
                    <div>
                      <label className="block text-sm font-bold text-slate-700 mb-1">Sample Variance (S²)</label>
                      <input type="number" step="0.01" value={sampleVariance} onChange={e => setSampleVariance(e.target.value)} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                  )}

                  {mode === 'proportion' && activeTab !== 'samplesize' && (
                    <div>
                      <label className="block text-sm font-bold text-slate-700 mb-1">Number of Successes (X)</label>
                      <input type="number" value={successes} onChange={e => setSuccesses(e.target.value)} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                  )}
                </div>
              )}

              {/* Hypothesis Specific Inputs */}
              {activeTab === 'hypothesis' && (
                <div className="pt-4 border-t border-slate-100 space-y-4">
                  <div>
                    <label className="block text-sm font-bold text-indigo-700 mb-1">Null Hypothesis (H₀)</label>
                    <input type="number" step="0.01" value={h0} onChange={e => setH0(e.target.value)} className="w-full px-4 py-2 bg-indigo-50 border border-indigo-100 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-indigo-700 mb-1">Alternative (H₁)</label>
                    <select value={h1Type} onChange={e => setH1Type(e.target.value)} className="w-full px-4 py-2 bg-indigo-50 border border-indigo-100 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none">
                      <option value="two">Two-Tailed (≠)</option>
                      <option value="left">Left-Tailed (&lt;)</option>
                      <option value="right">Right-Tailed (&gt;)</option>
                    </select>
                  </div>
                </div>
              )}

              {/* Alpha / Confidence Settings */}
              <div className="pt-4 border-t border-slate-100">
                {activeTab === 'samplesize' && (
                  <div className="mb-4">
                    <label className="block text-sm font-bold text-emerald-700 mb-1">Desired Margin of Error (E)</label>
                    <input type="number" step="0.01" value={marginError} onChange={e => setMarginError(e.target.value)} className="w-full px-4 py-2 bg-emerald-50 border border-emerald-100 rounded-lg outline-none" />
                  </div>
                )}
                {activeTab === 'hypothesis' ? (
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1">Significance Level (α)</label>
                    <input type="number" step="0.01" value={alpha} onChange={e => setAlpha(e.target.value)} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none" />
                  </div>
                ) : (
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1">Confidence Level (%)</label>
                    <select value={confLevel} onChange={e => setConfLevel(e.target.value)} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none">
                      <option value="90">90%</option>
                      <option value="95">95%</option>
                      <option value="99">99%</option>
                    </select>
                  </div>
                )}
              </div>

              {inputError && <div className="text-red-500 text-sm font-bold text-center mt-2">{inputError}</div>}
            </div>
          </div>

          {/* RIGHT PANEL: Results */}
          <div className="lg:col-span-8 bg-white rounded-3xl shadow-xl p-8 border border-slate-100 flex flex-col min-h-[500px]">
            {resultData ? (
              <div className="h-full flex flex-col">
                <div className="mb-6 text-center border-b border-slate-100 pb-6">
                  {resultData.parsedData && (
                    <div className="mb-4 inline-flex gap-4 bg-slate-50 px-4 py-2 rounded-lg text-sm text-slate-500 font-mono">
                      <span>n={resultData.parsedData.n}</span>
                      <span>x̄={resultData.parsedData.mean}</span>
                      <span>S={resultData.parsedData.stdDev}</span>
                    </div>
                  )}
                  <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-2">Final Result</h3>
                  <div className={`text-5xl font-black tracking-tight ${resultData.result.includes("Reject") ? "text-red-500" : "text-blue-600"}`}>
                    {resultData.result}
                  </div>
                  <p className="text-md font-bold text-slate-500 mt-3">{resultData.details}</p>
                  {/* Mathematical Formula Display */}
                  {resultData && (
                    <div className="mt-6 bg-slate-50 border border-slate-100 rounded-2xl p-5 text-left mb-6">
                      <h4 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-4">Formula Used</h4>
                      <div className="font-serif text-xl text-slate-700 font-bold text-center bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                        
                        {activeTab === 'samplesize' && (
                          <span>n = [ (Z<sub>α/2</sub> × σ) / E ]²</span>
                        )}
                        
                        {activeTab === 'interval' && mode === 'mean' && (
                          <span>x̄ ± {isSigmaKnown || n >= 30 ? <span>Z<sub>α/2</sub> × (σ / √n)</span> : <span>t<sub>α/2, n-1</sub> × (S / √n)</span>}</span>
                        )}
                        
                        {activeTab === 'interval' && mode === 'proportion' && (
                          <span>p̂ ± Z<sub>α/2</sub> × √[ p̂(1 - p̂) / n ]</span>
                        )}
                        
                        {activeTab === 'interval' && mode === 'variance' && (
                          <span>[ (n - 1)S² ] / χ²<sub>R</sub> &lt; σ² &lt; [ (n - 1)S² ] / χ²<sub>L</sub></span>
                        )}

                        {/* Lecture Method Breakdown: Confidence Intervals */}
                        {activeTab === 'interval' && resultData.criticalValues?.length > 0 && (
                          <div className="mt-6 bg-slate-50 border border-slate-100 rounded-2xl p-5 text-left mb-6">
                            <h4 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-4">Lecture Method Breakdown</h4>
                            <div className="space-y-3">
                              
                              {/* Step 1: Identify Givens */}
                              <div>
                                <span className="font-bold text-blue-600">Step 1:</span> Identify given information.
                                <div className="font-mono text-sm mt-1 text-slate-600 bg-white p-3 rounded-xl border border-slate-200">
                                  n = {n}, α = {(1 - confLevel/100).toFixed(2)}
                                  {mode === 'mean' && <>, x̄ = {mean}, {isSigmaKnown || n >= 30 ? 'σ' : 'S'} = {stdDev}</>}
                                  {mode === 'proportion' && <>, p̂ = {(successes/n).toFixed(4)}</>}
                                  {mode === 'variance' && <>, S² = {sampleVariance}, df = {Math.max(1, n - 1)}</>}
                                </div>
                              </div>

                              {/* Step 2: Critical Value */}
                              <div>
                                <span className="font-bold text-blue-600">Step 2:</span> Find the critical value(s).
                                <div className="font-mono text-sm mt-1 text-slate-600 bg-white p-3 rounded-xl border border-slate-200">
                                  {mode === 'variance' ? (
                                    <>
                                      χ²_R = {resultData.criticalValues[1].toFixed(4)} <br/>
                                      χ²_L = {resultData.criticalValues[0].toFixed(4)}
                                    </>
                                  ) : (
                                    <>
                                      {isSigmaKnown || n >= 30 || mode === 'proportion' ? 'Z' : 't'}_(α/2) = {resultData.criticalValues[1].toFixed(4)}
                                    </>
                                  )}
                                </div>
                              </div>

                              {/* Step 3: Formula Substitution */}
                              <div>
                                <span className="font-bold text-blue-600">Step 3:</span> Substitute into formula.
                                <div className="font-mono text-sm mt-1 text-slate-600 bg-white p-3 rounded-xl border border-slate-200 overflow-x-auto whitespace-nowrap">
                                  {mode === 'mean' && (
                                    <>
                                      {mean} ± {resultData.criticalValues[1].toFixed(4)} * ({stdDev} / √{n})
                                    </>
                                  )}
                                  {mode === 'proportion' && (
                                    <>
                                      {(successes/n).toFixed(4)} ± {resultData.criticalValues[1].toFixed(4)} * √[ ({(successes/n).toFixed(4)} * {1 - (successes/n).toFixed(4)}) / {n} ]
                                    </>
                                  )}
                                  {mode === 'variance' && (
                                    <>
                                      [ ({n} - 1) * {sampleVariance} ] / {resultData.criticalValues[1].toFixed(4)} &lt; σ² &lt; [ ({n} - 1) * {sampleVariance} ] / {resultData.criticalValues[0].toFixed(4)}
                                    </>
                                  )}
                                </div>
                              </div>

                              {/* Step 4: Final Interval */}
                              <div>
                                <span className="font-bold text-blue-600">Step 4:</span> Final Confidence Interval.
                                <div className="font-mono text-sm mt-1 text-slate-600 bg-white p-3 rounded-xl border border-slate-200">
                                  {resultData.result}
                                </div>
                              </div>
                              
                            </div>
                          </div>
                        )}
                        
                        {activeTab === 'hypothesis' && mode === 'mean' && (
                          <span>{isSigmaKnown || n >= 30 ? 'Z' : 't'} = (x̄ - μ<sub>0</sub>) / ({isSigmaKnown || n >= 30 ? 'σ' : 'S'} / √n)</span>
                        )}
                        
                        {activeTab === 'hypothesis' && mode === 'proportion' && (
                          <span>Z = (p̂ - p<sub>0</sub>) / √[ p<sub>0</sub>(1 - p<sub>0</sub>) / n ]</span>
                        )}
                        
                        {activeTab === 'hypothesis' && mode === 'variance' && (
                          <span>χ² = (n - 1)S² / σ²<sub>0</sub></span>
                        )}

                      </div>
                    </div>
                  )}

                  {/* Lecture Method Breakdown (Step 1 to 4) */}
                  {activeTab === 'hypothesis' && resultData.testStatistic !== undefined && (
                    <div className="mt-6 bg-slate-50 border border-slate-100 rounded-2xl p-5 text-left mb-6">
                      <h4 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-4">Lecture Method Breakdown</h4>
                      <div className="space-y-3">
                        
                        <div>
                          <span className="font-bold text-blue-600">Step 1:</span> State the statistical hypothesis.
                          <div className="font-mono text-sm mt-1 text-slate-600 bg-white p-3 rounded-xl border border-slate-200">
                            H₀: {mode === 'mean' ? 'μ' : mode === 'proportion' ? 'P' : 'σ²'} = {h0} <br/>
                            H₁: {mode === 'mean' ? 'μ' : mode === 'proportion' ? 'P' : 'σ²'} {h1Type === 'left' ? '<' : h1Type === 'right' ? '>' : '≠'} {h0}
                          </div>
                        </div>
                        
                        <div>
                          <span className="font-bold text-blue-600">Step 2:</span> Find the critical value.
                          <div className="font-mono text-sm mt-1 text-slate-600 bg-white p-3 rounded-xl border border-slate-200">
                            α = {alpha} {mode !== 'proportion' && (isSigmaKnown || n >= 30 ? '' : `| df = ${Math.max(1, n - 1)}`)} <br/>
                            Crit = {resultData.criticalValues.map(v => v.toFixed(3)).join(' and ')}
                          </div>
                        </div>
                        
                        <div>
                          <span className="font-bold text-blue-600">Step 3:</span> Calculate test value.
                          <div className="font-mono text-sm mt-1 text-slate-600 bg-white p-3 rounded-xl border border-slate-200 leading-relaxed overflow-x-auto whitespace-nowrap">
                            {mode === 'mean' && (
                              <>
                                {isSigmaKnown || n >= 30 ? 'Z' : 't'} = (x̄ - μ₀) / ({isSigmaKnown || n >= 30 ? 'σ' : 'S'} / √n) <br/>
                                {isSigmaKnown || n >= 30 ? 'Z' : 't'} = ({mean} - {h0}) / ({stdDev} / √{n}) <br/>
                                {isSigmaKnown || n >= 30 ? 'Z' : 't'} = {resultData.testStatistic.toFixed(3)}
                              </>
                            )}
                            {mode === 'proportion' && (
                              <>
                                Z = (p̂ - p₀) / √[ p₀(1 - p₀) / n ] <br/>
                                Z = ({(successes/n).toFixed(4)} - {h0}) / √[ {h0}(1 - {h0}) / {n} ] <br/>
                                Z = {resultData.testStatistic.toFixed(3)}
                              </>
                            )}
                            {mode === 'variance' && (
                              <>
                                χ² = (n - 1)S² / σ²₀ <br/>
                                χ² = ({n} - 1) × {sampleVariance} / {h0} <br/>
                                χ² = {resultData.testStatistic.toFixed(3)}
                              </>
                            )}
                          </div>
                        </div>
                        
                        <div>
                          <span className="font-bold text-blue-600">Step 4:</span> Make the decision.
                          <div className="font-mono text-sm mt-1 text-slate-600 bg-white p-3 rounded-xl border border-slate-200 leading-relaxed">
                            We note that the test value ({resultData.testStatistic.toFixed(3)}) falls in the <span className="font-bold text-slate-800">{resultData.result.includes("Reject") ? "reject" : "accept"}</span> region. <br/>
                            We <span className="font-bold text-slate-800">{resultData.result.includes("Reject") ? "reject" : "accept"} H₀</span> so the test is <span className="font-bold text-slate-800">{resultData.result.includes("Reject") ? "significant" : "not significant"}</span>.
                          </div>
                        </div>
                        
                      </div>
                    </div>
                  )}
                </div>
                
                {resultData.chartData?.length > 0 && (
                  <div className="flex-grow min-h-[300px] mt-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartDataWithTails} margin={{ top: 20, right: 20, left: 0, bottom: 45 }}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.2} vertical={false} />
                        <XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} tick={{fill: '#94a3b8', fontWeight: 'bold'}} 
                        axisLine={{ stroke: '#475569', strokeWidth: 2 }} tickLine={{ stroke: '#475569', strokeWidth: 2 }} />
                        <YAxis tick={false} axisLine={false} width={10} />
                        <Tooltip formatter={(value) => value.toFixed(4)} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}/>

                      
                      {/* 3. The Dotted Critical Lines (Smart Staggering!) */}
                        {resultData.criticalValues?.map((val, idx) => (
                          <ReferenceLine 
                          key={idx} 
                          segment={[{ x: val, y: 0 }, { x: val, y: getCurveHeight(val) }]} 
                          stroke="#ef4444" 
                            strokeWidth={2} 
                            strokeDasharray="4 4" 
                            label={{ 
                              position: 'bottom', 
                              value: `Crit: ${val.toFixed(2)}`, 
                              fill: '#ef4444', 
                              fontWeight: 'bold',
                              dy: (areCritsClose && idx === 1) ? 40 : 25 // Only drops down if they are actually squished!
                            }} 
                            />
                          ))}
                      {/* 4. Your Green Test Statistic Marker (Dynamically offsets text to avoid the curve) */}
                        {resultData.testStatistic !== undefined && resultData.testStatistic !== null && (
                          <ReferenceLine
                          segment={[
                            { x: resultData.testStatistic, y: 0 },
                            { x: resultData.testStatistic, y: getCurveHeight(resultData.testStatistic) }
                          ]}
                          stroke={resultData.result?.includes('Reject') ? '#ef4444' : '#10b981'}
                          strokeWidth={3}
                          label={{
                            position: 'top',
                            value: `Stat: ${resultData.testStatistic.toFixed(2)}`,
                            fill: resultData.result?.includes('Reject') ? '#ef4444' : '#10b981',
                            fontWeight: 'bold',
                            fontSize: 16,
                            dy: -10,
                            dx: resultData.testStatistic >= 0 ? 40 : -40 // The magic fix!
                          }}
                          />
                        )}
                        {/* 3. The Green Accept Region (Paints the middle!) */}
                        <Area type="linear" dataKey="yAccept" stroke="none" fill="#10b981" fillOpacity={0.3} />

                        <ReferenceLine x={0} stroke="#475569" strokeWidth={2} />
                        {/* 2. TRUE Shaded Tails (Paints behind the main blue stroke) */}
                        <Area type="linear" dataKey="yTail" stroke="none" fill="#ef4444" fillOpacity={0.3} />

                        {/* 1. Main Curve (Moved to the BOTTOM! Its 3px stroke will now cleanly cover the tips of the lines) */}
                        <Area type="linear" dataKey="y" stroke="#3b82f6" strokeWidth={3} fillOpacity={0.05} fill="#3b82f6" />

                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-slate-300">
                <div className="text-6xl mb-4">📊</div>
                <p className="text-xl font-bold">Awaiting Data</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}