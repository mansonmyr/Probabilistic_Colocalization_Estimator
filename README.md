# Probabilistic Colocalization Estimator (PCE)

A ROI-centric bioimage analysis workbench for 8-bit/16-bit multichannel TIFF data. This tool provides robust statistical estimates of protein-protein overlap and correlation with absolute raw data fidelity, specifically designed for high-precision immunofluorescence research. This software allows an alternative options other than the traditional colocalization analysis software such as *JaCOP* and *Coloc 2* in Fiji/ImageJ.

---

## 🔬 Scientific Interpretation: Measurement Readout

The **Colocalization Readout** provides a focused scientific profile of your Regions of Interest (ROIs), utilizing advanced statistical modeling to distinguish biological coupling from random overlap.

### 1. Robust Colocalization Metrics
- **Manders Split Coefficients (M1/M2) via Costes Automated Threshold**:
    - **Mathematics**: Implements the **Costes Automated Threshold** algorithm, which iteratively finds the threshold pair where the Pearson correlation of background pixels is $\leq 0$.
    - **Significance**: 
        - **M1**: Fraction of Target signal overlapping with Candidate signal (above threshold).
        - **M2**: Fraction of Candidate signal overlapping with Target signal (above threshold).
    - **Precision**: Costes is the gold standard in microscopy as it removes bias from non-uniform background noise and sample brightness.
- **Discovery Score (Weighted Co-Probability)**:
    - **Mathematics**: $P(\text{Coupling}) \times \text{Variance Explained} (r^2)$. It utilizes a **Likelihood Ratio Test (LRT)** on a bivariate Gaussian fit.
    - **Scientific Rationale**: Traditional significance tests (p-values) often hit 100% simply due to high pixel counts (*High N Inflation*). By weighting significance by $r^2$ (effect size), PCE ensures that weak relationships are penalized, providing a "scientifically honest" discovery metric.
- **Manders Overlap Coefficient (MOC)**:
    - **Definition**: A measure of pixel overlap independent of signal intensity, providing a global view of spatial coincidence.

### 2. Multi-Linear Regression & Binding Exclusivity
- **Link Strength Ratio (LSR)**:
    - **Mathematics**: PCE fits a **Multiple Linear Regression (MLR)** model using **Standardized Beta Coefficients** ($\beta$) derived from z-scored pixel intensities across all channels.
    - **Metric**: The ratio of the $| \text{Strongest } \beta | / | \text{Second Strongest } \beta |$.
    - **Significance**: 
        - **Ratio > 2.0 (Exclusive)**: Suggests a specific, dominant binding partner.
        - **Ratio $\approx$ 1.0 (Promiscuous)**: Suggests the protein interacts equally with multiple partners in the ROI.
        - **N/A (Single Partner)**: Displayed for 2-channel images where no competition exists.
- **$R^2$ (Total Variance Explained)**:
    - Indicates how much of the target protein's spatial distribution is explained by the collective candidate protein network.

### 3. ROI Multivariate Profiling (Phenotypic Fingerprinting)

- Instead of a "black-box" classification, PCE synthesizes these measurements into a **Diagnostic Vector**. This 4-feature profile allows researchers to objectively characterize biological phenotypes based on their statistical signature.

   #### The 4-Feature Vector
    a.  **Intensity Flux**: Measures signal heterogeneity (Coefficient of Variation). High flux indicates punctate/vesicular signal; low flux indicates diffuse cytosolic distribution.

    b.  **Spatial Correlation ($PCC$)**: The standard linear relationship ($r$).

    c.  **Link Strength Ratio**: The exclusivity of the protein-protein coupling.

    d.  **Predictive Power ($R^2$)**: The overall reliability of the multi-channel model.

### Interpreting the Profile
| Phenotype | Intensity Flux | PCC | Link Strength | $R^2$ |
| :--- | :--- | :--- | :--- | :--- |
| **Specific Complex** | High | High | High (> 2.0) | High |
| **Multi-Protein Scaffold** | High | High | Low (≈ 1.0) | High |
| **Diffuse Interaction** | Low | Mid | Low (≈ 1.0) | Mid |
| **Stochastic Overlap** | Variable | Low | N/A | Low |

**Note**: This multivariate approach ensures that biological conclusions are based on the convergence of multiple statistical truths rather than a single, potentially biased coefficient.

---

## 💡 Comparing to JaCOP and Coloc 2 (Fiji/ImageJ) 

While both JaCoP and Coloc2 are powerful, they are fundamentally designed for pairwise analysis (Channel A vs. Channel B). If you have a three or four-channel dataset, these tools will not allow you to analyze the relationship between all channels in a single calculation or a single multi-variate model.

| Feature | JaCoP / Coloc 2 | PCE |
| :--- | :--- | :--- |
| **Input** | 2 Channels only | Up to 4 Channels simultaneously |
| **Math Model** | Correlation / Overlap | Multiple Linear Regression (MLR) |
| **Logic** | Independent pairs | Competitive/Exclusivity (LSR) |
| **Thresholding** | Manual or Costes (Pairwise) | Costes (Global/N-Channel) |

---

## 🛠️ Transparent Preprocessing Workflow

The software provides zero-overhead transparency to preserve the absolute fidelity of your 16-bit raw data:

1. **Live Preprocessing Preview**:
    - Toggle Background Subtraction and Denoising to see a live composite before running analysis.
    - Uses a non-destructive pipeline that reflects intended math on the display without mutating the underlying analysis buffer.
2. **Background Subtraction (Rolling Ball)**:
    - **Fixed for 16-bit**: PCE correctly handles background subtraction on 16-bit normalized floats, ensuring the "rolling ball" height is proportional to the actual signal intensity. 
    - **Np.clip Protection**: Prevents negative values after subtraction, maintaining physical realism.
3. **Denoising (N2V dazzling-spider)**:
    - Suppress pixel-level noise using the high-performance **Noise2Void** model. 
    - **Mean/Std Alignment**: Denoised results are aligned to the original exposure profile to ensure signal conservation.

    Note: This project utilizes the Noise2Void (N2V) library, which is licensed under the BSD 3-Clause License. Copyright (c) 2018, Alexander Krull, Tim-Oliver Buchholz, Florian Jug. 
    N2V was downloaded from (https://github.com/juglab/n2v). The *dazzling-spider* model was downloaded from Bioimage.io repository (https://archive.bioimage.io/#/?tags=dazzling-spider&id=dazzling-spider)

---

## 🚀 Installation & Setup

### **Image set-up**
0. **Fiji/ImageJ Preprocessing**:
    Image can be 8-bit or 16-bit, and suggested to use smaller (e.g. 512x512) pixel size, else it would take a long time on local cpu. Size can be adjusted in Fiji by **Image > Scale**. It would be better to keep the aspect ratio the same, and do not use Maximum Intensity Projection for z-stack.
    If the image is in RGB (merged), please split cell first, before re-merging it into **composite** in FIji/ImageJ. 

### **Backend Setup (Python 3.11+)**
1. **Prepare Environment**:
    ```bash
    cd backend
    python3 -m venv .venv
    source .venv/bin/activate  # Windows: .\.venv\Scripts\Activate.ps1
    pip install -e .
    ```
2. **Launch API**:
    ```bash
    python app/main.py
    ```

### **Frontend Setup (Node.js)**
1. **Install Dependencies**:
    ```bash
    cd frontend
    npm install
    ```
2. **Launch Development Server**:
    ```bash
    npm run dev
    ```

---

## 🧪 Requirements
- **Backend**: `FastAPI`, `PyTorch` (for N2V), `statsmodels` (for MLR), `scikit-image`, `scipy`.
- **Frontend**: `React`, `TypeScript`, `Vite`.
