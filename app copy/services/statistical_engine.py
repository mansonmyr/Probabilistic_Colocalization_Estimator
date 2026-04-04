import logging
import math
import numpy as np
import pandas as pd
import statsmodels.api as sm
from scipy import stats
from sklearn.ensemble import RandomForestClassifier

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Costes Automatic Threshold
# ---------------------------------------------------------------------------

def costes_auto_threshold(ch_a: np.ndarray, ch_b: np.ndarray) -> tuple[float, float]:
    """
    Costes automatic threshold for Manders M1/M2.
    Iteratively finds the threshold pair where the Pearson correlation
    of the background pixels (below threshold) is ≤ 0.
    Returns (threshold_a, threshold_b).
    """
    a = ch_a.flatten().astype(np.float64)
    b = ch_b.flatten().astype(np.float64)

    if np.std(a) < 1e-9 or np.std(b) < 1e-9:
        return 0.0, 0.0

    # Fit a linear regression of b on a to get the relationship
    slope, intercept, _, _, _ = stats.linregress(a, b)

    # Iterate from max intensity downward
    a_max = float(np.max(a))
    step = a_max / 256.0  # 256 steps for efficiency
    if step < 1e-12:
        return 0.0, 0.0

    thresh_a = a_max
    thresh_b = slope * thresh_a + intercept

    for _ in range(256):
        thresh_a -= step
        thresh_b = slope * thresh_a + intercept
        if thresh_a < 0 or thresh_b < 0:
            break

        # Select pixels below threshold (background)
        bg_mask = (a < thresh_a) & (b < thresh_b)
        n_bg = int(np.sum(bg_mask))
        if n_bg < 5:
            continue

        a_bg = a[bg_mask]
        b_bg = b[bg_mask]

        if np.std(a_bg) < 1e-9 or np.std(b_bg) < 1e-9:
            continue

        r_bg = np.corrcoef(a_bg, b_bg)[0, 1]
        if np.isnan(r_bg):
            continue

        # Stop when background correlation drops to zero or below
        if r_bg <= 0:
            return float(thresh_a), float(thresh_b)

    # Fallback: use mean intensity
    return float(np.mean(a)), float(np.mean(b))


def manders_m1_m2(
    target: np.ndarray,
    candidate: np.ndarray,
    use_costes: bool = True,
) -> tuple[float, float, float]:
    """
    Computes Manders Overlap Coefficient (MOC) and split coefficients M1, M2.

    MOC = Σ(T_i * C_i) / sqrt(Σ(T_i²) * Σ(C_i²))
    M1  = Σ(T_i where C_i > thresh_c) / Σ(T_i)   — fraction of target colocalizing
    M2  = Σ(C_i where T_i > thresh_t) / Σ(C_i)   — fraction of candidate colocalizing

    Returns (moc, m1, m2).
    """
    t = target.flatten().astype(np.float64)
    c = candidate.flatten().astype(np.float64)

    # MOC (Overlap Coefficient)
    denom = np.sqrt(np.sum(t ** 2) * np.sum(c ** 2))
    moc = float(np.sum(t * c) / (denom + 1e-12))

    # Thresholded M1 / M2
    if use_costes:
        thresh_t, thresh_c = costes_auto_threshold(t, c)
    else:
        thresh_t = float(np.mean(t))
        thresh_c = float(np.mean(c))

    t_total = float(np.sum(t))
    c_total = float(np.sum(c))

    m1 = float(np.sum(t[c > thresh_c]) / (t_total + 1e-12)) if t_total > 0 else 0.0
    m2 = float(np.sum(c[t > thresh_t]) / (c_total + 1e-12)) if c_total > 0 else 0.0

    return moc, min(m1, 1.0), min(m2, 1.0)


# ---------------------------------------------------------------------------
# Link Strength Ratio (Standardized Beta MLR)
# ---------------------------------------------------------------------------

def calculate_link_strength_ratio(
    target_pixels: np.ndarray,
    candidate_channels_dict: dict[str, np.ndarray],
) -> dict:
    """
    Calculates the Link Strength Ratio for a Target Channel against
    multiple Candidate Channels within an ROI using statsmodels OLS
    with z-scored (standardized) channels.

    Returns dict with: strongest_link, link_strength_ratio, all_betas, p_values, r_squared.
    """
    def z_score(x: np.ndarray) -> np.ndarray:
        return (x - np.mean(x)) / (np.std(x) + 1e-10)

    y = z_score(target_pixels.flatten())

    X_data = {}
    for name, pixels in candidate_channels_dict.items():
        X_data[name] = z_score(pixels.flatten())

    X = pd.DataFrame(X_data)

    n = len(y)
    k = X.shape[1]

    if n <= k + 1 or k == 0:
        fallback_name = list(candidate_channels_dict.keys())[0] if candidate_channels_dict else "N/A"
        return {
            "strongest_link": fallback_name,
            "link_strength_ratio": None,
            "all_betas": {name: 0.0 for name in candidate_channels_dict},
            "p_values": {name: 1.0 for name in candidate_channels_dict},
            "r_squared": 0.0,
        }

    try:
        # OLS without intercept (z-scored data has zero mean)
        model = sm.OLS(y, X).fit()

        betas = model.params.abs().sort_values(ascending=False)
        raw_betas = model.params.to_dict()

        if len(betas) < 2:
            # Single candidate — ratio is undefined
            link_ratio = None
        else:
            strongest_beta = betas.iloc[0]
            second_strongest_beta = betas.iloc[1]
            epsilon = 1e-10
            link_ratio = float((strongest_beta + epsilon) / (second_strongest_beta + epsilon))

        return {
            "strongest_link": betas.index[0],
            "link_strength_ratio": link_ratio,
            "all_betas": {k: float(v) for k, v in raw_betas.items()},
            "p_values": {k: float(v) for k, v in model.pvalues.to_dict().items()},
            "r_squared": float(max(min(model.rsquared, 1.0), 0.0)),
        }
    except Exception:
        fallback_name = list(candidate_channels_dict.keys())[0] if candidate_channels_dict else "N/A"
        return {
            "strongest_link": fallback_name,
            "link_strength_ratio": None,
            "all_betas": {name: 0.0 for name in candidate_channels_dict},
            "p_values": {name: 1.0 for name in candidate_channels_dict},
            "r_squared": 0.0,
        }


# ---------------------------------------------------------------------------
# Legacy MLR (kept for backward compat, now wraps statsmodels)
# ---------------------------------------------------------------------------

def multiple_linear_regression(
    pixels_target: np.ndarray,
    pixels_candidates: list[np.ndarray],
) -> dict:
    """
    Performs MLR and returns R², standardized betas, and p-values.
    Uses statsmodels for robust estimation.
    """
    candidate_dict = {f"Ch_{i}": c.flatten() for i, c in enumerate(pixels_candidates)}
    result = calculate_link_strength_ratio(pixels_target, candidate_dict)
    return {
        "r_squared": result["r_squared"],
        "betas": [result["all_betas"].get(f"Ch_{i}", 0.0) for i in range(len(pixels_candidates))],
        "p_values": [result["p_values"].get(f"Ch_{i}", 1.0) for i in range(len(pixels_candidates))],
    }


# ---------------------------------------------------------------------------
# Bivariate MLE LRT (Co-Probability = "Discovery Score")
# ---------------------------------------------------------------------------

def bivariate_mle_lrt(target: np.ndarray, candidate: np.ndarray) -> float:
    """
    Fits a Bivariate Gaussian under H0 (independent) and H1 (correlated).
    Executes a Likelihood Ratio Test and returns the "Discovery Score":

        Co-Probability = chi2_cdf(LRT_stat) × r²

    This weights statistical significance by effect size to prevent
    the "High N Inflation" problem where large pixel counts drive
    co-probability to 100% even with negligible correlation.
    """
    t = target.flatten()
    c = candidate.flatten()
    n = len(t)

    if n < 3:
        return 0.0

    # Pearson with zero-variance protection
    if np.std(t) < 1e-9 or np.std(c) < 1e-9:
        return 0.0

    correlation = np.corrcoef(t, c)[0, 1]

    if np.isnan(correlation):
        return 0.0

    # Bound correlation to prevent log(0)
    correlation = max(min(correlation, 0.999), -0.999)

    # LRT Statistic: -n * ln(1 - rho^2)
    lrt_stat = -n * math.log(1 - (correlation ** 2))

    # Statistical significance from chi-squared CDF
    significance = stats.chi2.cdf(lrt_stat, df=1)

    # Discovery Score: weight significance by r² (coefficient of determination)
    # This ensures low PCC → low co-probability regardless of sample size.
    co_probability = significance * (correlation ** 2)

    return float(co_probability)


# ---------------------------------------------------------------------------
# ROI Classifier (Random Forest)
# ---------------------------------------------------------------------------

class ROIClassifier:
    """
    Random Forest Classifier for ROI categorization.
    Features: [intensity_flux, spatial_correlation (PCC), R², link_strength_ratio]
    """
    def __init__(self):
        self.model = RandomForestClassifier(n_estimators=10, max_depth=5, random_state=42)
        self.is_trained = False
        self._seed_mock_data()

    def _seed_mock_data(self):
        # Features: [intensity_flux, spatial_corr (PCC), R², link_strength_ratio]
        X_mock = np.array([
            [0.85, 0.90, 0.80, 3.5],   # Vesicular (high flux, high corr, exclusive link)
            [0.90, 0.85, 0.90, 1.2],   # Filamentous (high flux, promiscuous)
            [0.10, 0.10, 0.05, 1.0],   # Random (low everything)
            [0.80, 0.85, 0.75, 4.0],   # Vesicular
            [0.88, 0.80, 0.85, 1.1],   # Filamentous
            [0.05, 0.05, 0.01, 1.0],   # Random
        ])
        y_mock = np.array([
            "Vesicular", "Filamentous", "Random",
            "Vesicular", "Filamentous", "Random",
        ])
        self.model.fit(X_mock, y_mock)
        self.is_trained = True

    def predict(
        self,
        intensity_flux: float,
        spatial_correlation: float,
        r_squared: float,
        link_strength_ratio: float,
    ) -> str:
        features = np.array([[
            intensity_flux,
            spatial_correlation,
            r_squared,
            link_strength_ratio,
        ]])
        return self.model.predict(features)[0]


# Global singleton
roi_classifier = ROIClassifier()
