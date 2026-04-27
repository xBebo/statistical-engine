from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
import scipy.stats as stats
import numpy as np
import math

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class StatRequest(BaseModel):
    calcType: str 
    mode: str
    confLevel: float = 95
    alpha: float = 0.05
    n: int = 0
    mean: float = 0
    stdDev: float = 0
    sampleVariance: float = 0 
    isSigmaKnown: bool = False
    successes: int = 0
    h0: float = 0
    h1Type: str = "two" 
    rawData: Optional[List[float]] = None
    marginError: float = 0.05

# Upgraded Generator: Dynamically stretches the X-axis to fit all markers!
def generate_curve_data(dist_type, df=1, markers=None):
    if markers is None: markers = []
    data = []
    
    if dist_type in ["Z", "T"]:
        # Check if any markers are outside the standard -4 to 4 range
        min_x = min([-4.0] + markers) - 1.0
        max_x = max([4.0] + markers) + 1.0
        x_vals = np.linspace(min_x, max_x, 200) # Increased resolution for wider graphs
        
        for x in x_vals:
            y = stats.norm.pdf(x, 0, 1) if dist_type == "Z" else stats.t.pdf(x, df)
            data.append({"x": round(float(x), 2), "y": round(float(y), 4)})
            
    elif dist_type == "Chi2":
        max_x = stats.chi2.ppf(0.999, df) if df < 50 else df * 2
        max_x = max([max_x] + markers) + max(5.0, df * 0.2) # Pad the right side
        x_vals = np.linspace(0, max_x, 200)
        
        for x in x_vals:
            y = stats.chi2.pdf(x, df)
            data.append({"x": round(float(x), 2), "y": round(float(y), 4)})
            
    return data

@app.post("/calculate")
def calculate_stats(req: StatRequest):
    if req.rawData and len(req.rawData) > 1:
        req.n = len(req.rawData)
        req.mean = float(np.mean(req.rawData))
        req.stdDev = float(np.std(req.rawData, ddof=1)) 
        req.sampleVariance = req.stdDev ** 2

    if req.stdDev > 0 and req.sampleVariance == 0:
        req.sampleVariance = req.stdDev ** 2
    elif req.sampleVariance > 0 and req.stdDev == 0:
        req.stdDev = math.sqrt(req.sampleVariance)

    response_data = {
        "result": "",
        "details": "",
        "chartData": [],
        "criticalValues": [],
        "testStatistic": None,
        "parsedData": {"n": req.n, "mean": round(req.mean, 4), "stdDev": round(req.stdDev, 4)} if req.rawData else None
    }

    a = 1 - (req.confLevel / 100) if req.calcType == "interval" else req.alpha

    if req.calcType == "samplesize":
        crit = stats.norm.ppf(1 - a/2)
        n_calc = math.ceil(((crit * req.stdDev) / req.marginError) ** 2)
        response_data["result"] = f"Required n = {n_calc}"
        response_data["details"] = f"Z-Dist | Margin of Error: {req.marginError} | Crit: {crit:.4f}"
        return response_data

    if req.calcType == "interval":
        if req.mode == "mean":
            is_z = req.isSigmaKnown or req.n >= 30
            df = max(1, req.n - 1)
            crit = stats.norm.ppf(1 - a/2) if is_z else stats.t.ppf(1 - a/2, df)
            margin = crit * (req.stdDev / np.sqrt(req.n))
            response_data["result"] = f"[{req.mean - margin:.4f}, {req.mean + margin:.4f}]"
            response_data["details"] = f"{'Z' if is_z else 'T'}-Dist | Critical Value: {crit:.4f}"
            response_data["criticalValues"] = [-crit, crit]
            response_data["chartData"] = generate_curve_data("Z" if is_z else "T", df, response_data["criticalValues"])

        elif req.mode == "proportion":
            p_hat = req.successes / req.n
            crit = stats.norm.ppf(1 - a/2)
            margin = crit * np.sqrt((p_hat * (1 - p_hat)) / req.n)
            response_data["result"] = f"[{max(0, p_hat - margin):.4f}, {min(1, p_hat + margin):.4f}]"
            response_data["details"] = f"Z-Dist | p̂ = {p_hat:.4f} | Crit: {crit:.4f}"
            response_data["criticalValues"] = [-crit, crit]
            response_data["chartData"] = generate_curve_data("Z", 1, response_data["criticalValues"])

        elif req.mode == "variance":
            df = max(1, req.n - 1)
            chi_right = stats.chi2.ppf(1 - a/2, df)
            chi_left = stats.chi2.ppf(a/2, df)
            lower = (df * req.sampleVariance) / chi_right
            upper = (df * req.sampleVariance) / chi_left
            response_data["result"] = f"[{lower:.4f}, {upper:.4f}]"
            response_data["details"] = f"Chi-Square | df = {df} | Crit L: {chi_left:.4f}, Crit R: {chi_right:.4f}"
            response_data["criticalValues"] = [chi_left, chi_right]
            response_data["chartData"] = generate_curve_data("Chi2", df, response_data["criticalValues"])

    elif req.calcType == "hypothesis":
        if req.mode == "mean":
            is_z = req.isSigmaKnown or req.n >= 30
            test_stat = (req.mean - req.h0) / (req.stdDev / np.sqrt(req.n))
            df = max(1, req.n - 1)
            
            if req.h1Type == "left":
                crit = stats.norm.ppf(a) if is_z else stats.t.ppf(a, df)
                reject = test_stat < crit
                response_data["criticalValues"] = [crit]
            elif req.h1Type == "right":
                crit = stats.norm.ppf(1-a) if is_z else stats.t.ppf(1-a, df)
                reject = test_stat > crit
                response_data["criticalValues"] = [crit]
            else:
                crit = stats.norm.ppf(1-a/2) if is_z else stats.t.ppf(1-a/2, df)
                reject = abs(test_stat) > crit
                response_data["criticalValues"] = [-crit, crit]

            response_data["result"] = "Reject H0" if reject else "Accept H0"
            response_data["details"] = f"{'Z' if is_z else 'T'}-Test | Stat: {test_stat:.4f}"
            response_data["testStatistic"] = test_stat
            response_data["chartData"] = generate_curve_data("Z" if is_z else "T", df, response_data["criticalValues"] + [test_stat])

        elif req.mode == "proportion":
            p_hat = req.successes / req.n
            test_stat = (p_hat - req.h0) / np.sqrt((req.h0 * (1 - req.h0)) / req.n)
            
            if req.h1Type == "left":
                crit = stats.norm.ppf(a)
                reject = test_stat < crit
                response_data["criticalValues"] = [crit]
            elif req.h1Type == "right":
                crit = stats.norm.ppf(1-a)
                reject = test_stat > crit
                response_data["criticalValues"] = [crit]
            else:
                crit = stats.norm.ppf(1-a/2)
                reject = abs(test_stat) > crit
                response_data["criticalValues"] = [-crit, crit]

            response_data["result"] = "Reject H0" if reject else "Accept H0"
            response_data["details"] = f"Z-Test for P | Stat: {test_stat:.4f}"
            response_data["testStatistic"] = test_stat
            response_data["chartData"] = generate_curve_data("Z", 1, response_data["criticalValues"] + [test_stat])

        elif req.mode == "variance":
            df = max(1, req.n - 1)
            test_stat = (df * req.sampleVariance) / req.h0
            
            if req.h1Type == "left":
                crit = stats.chi2.ppf(a, df)
                reject = test_stat < crit
                response_data["criticalValues"] = [crit]
            elif req.h1Type == "right":
                crit = stats.chi2.ppf(1-a, df)
                reject = test_stat > crit
                response_data["criticalValues"] = [crit]
            else:
                crit_l = stats.chi2.ppf(a/2, df)
                crit_r = stats.chi2.ppf(1-a/2, df)
                reject = test_stat < crit_l or test_stat > crit_r
                response_data["criticalValues"] = [crit_l, crit_r]

            response_data["result"] = "Reject H0" if reject else "Accept H0"
            response_data["details"] = f"Chi-Square Test | df = {df}"
            response_data["testStatistic"] = test_stat
            response_data["chartData"] = generate_curve_data("Chi2", df, response_data["criticalValues"] + [test_stat])

    return response_data