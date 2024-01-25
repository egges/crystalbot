import mathjs                               from "mathjs";


/* @function minVarWeights
*
* @summary Compute the weights of the proportional minimum variance (heuristic) portfolio.
*
* @description This function returns the weights w_1,...,w_n associated to the fully invested and long-only 
* proportional minimum variance (heuristic) portfolio of n assets, as computed by the minimum variance algorithm of the reference.
*
* This portfolio is unique.
* 
* This portfolio is meant to approximate the global minimum variance (GMV) portfolio.
*
* The algorithm used is the minimum variance algorithm (MVA), with primary benefits versus the conventional optimization methods:
* - speed of computation and ease of calculation 
* - greater robustness to estimation error
* - superior risk dispersion
*
* @see <a href="https://cssanalytics.wordpress.com/2013/04/05/minimum-variance-algorithm-mva-excel-sheet/">Minimum Variance Algorithm (MVA) Excel Sheet</a>
*
* @param {Matrix_|Array.<Array.<number>>} sigma the covariance matrix (sigma_ij),i,j=1..n of the n assets in the considered universe, square Matrix or array of n array of n real numbers statisfying sigma[i-1][j-1] = sigma_ij.
* @param {object} opt the optional parameters for the algorithm, unused.
* @return {Array.<number>} the weights corresponding to theminimum variance (heuristic) portfolio, array of n real numbers.
*
* @example
* minVarWeights([[0.1, 0], [0, 0.2]]);
* // ~[0.86, 0.14] 
*/
export function minVarWeights(sigma: number[][], constraints?: { min?: number, max?: number }): number[] {
	
	constraints = Object.assign({
        min: 0, max: 1
    }, constraints);

    let weights = computeMinVarWeights(sigma);
    if (computeWeightError(weights, constraints.min, constraints.max) === 0) {
        // we are done
        return weights;
    }
    // do a binary search like approach to find weights adhering to constraints
    let e = 0.0001;
    let l = 0;
    let r = 1;
    let iterations = 0;
    // first check that the leftmost weights do not adhere to the constraints
    while (iterations < 1000) {
        iterations += 1;
        let m = (l + r) / 2;
        // 
        // compute the weigths
        const weights = computeMinVarWeights(shrink(sigma, m));
        const error = computeWeightError(weights, constraints.min, constraints.max);
        // compute the weight constraint error
        if (error < e) {
            return weights;
        } else if (error === 0) {
            // we went to far to the right
            r = m;
        } else {
            // we didn't go far enough to the right
            l = m;
        }
    }
}

function computeWeightError(weights: number[], min: number, max: number): number {
    let error = 0;
    for (const w of weights) {
        if (w < min) {
            error = Math.max(error, min - w);
        } else if (w > max) {
            error = Math.max(error, w - max);
        }
    }
    return error;
}

function computeMinVarWeights(sigma: number[][]) {
    // Step 1: Average pairwise covariance, and associated mean/standard deviation
	const rowsAverages: number[] = [];
	for (let i = 0; i < sigma.length; i += 1) {
		rowsAverages.push(mathjs.mean(sigma[i]));
	}
    const elementsMean = mathjs.mean(rowsAverages);
    var elementsStddev = mathjs.std(rowsAverages);

    if (elementsStddev === 0) {
        // simply return equal weights
        return new Array(rowsAverages.length).fill(1 / rowsAverages.length);
    }

	// Step 2: Gaussian convertion, and proportional average covar weigth
	var weights = normalize(rowsAverages.map((value) => { 
		return 1 - normcdf((value - elementsMean)/elementsStddev);
	}));
	
	// Step 3: Scale portfolio weights by assets variances
    var invVariancesWeights = normalize(diagonal(sigma).map((val) =>  1 /val));

    return normalize(vectorHadamardProduct(weights, invVariancesWeights));
}

export function vectorHadamardProduct(v: number[], w: number[]): number[] {
    return v.map((value, index) => value * w[index]);
}


export function shrink(matrix: number[][], factor: number) {
    const identity = identityMatrix(matrix.length);
    for (let i = 0; i < matrix.length; i += 1) {
        for (let j = 0; j < matrix.length; j += 1) {
            matrix[i][j] = (1 - factor) * matrix[i][j] + factor * identity[i][j];
        }
    }
    return matrix;
}


export function identityMatrix(length: number): number[][] {
    const identityMatrix = [];
    // add the rows
    for (let i = 0; i < length; i += 1) {
        const row = new Array(length).fill(0);
        row[i] = 1;
        identityMatrix.push(row);
    }
    return identityMatrix;
}


export function diagonal(matrix: number[][]): number[] {
    const result: number[] = []
    
    // Extraction of diagonal elements of the matrix
    for (let i = 0; i < matrix.length; i += 1) {
        if (matrix[i].length !== matrix.length) {
            throw new Error("Matrix is not square.");
        }
        result.push(matrix[i][i]);
    }
    return result;
}

export function normalize(vector: number[]) {
    // compute the sum of the vector elements (use 1 if sum is 0)
    const sum = vector.reduce((a, b) => a + b, 0) || 1;
    // return the normalized vector
    return vector.map((value) => value / sum );
}

/**
* @function normcdf_
*
* This function returns an approximation of the standard normal cumulative distribution function, i.e.
* given x a real number, it returns an approximation to p = Pr{Z <= x} where Z is a
* random variable following a standard normal distribution law.
*
* This function is also called Phi in the statistical litterature.
*
* The algorithm uses a Taylor expansion around 0 of a well chosen function of Phi.
* The algorithm has an absolute error of less than 8e−16.
*
* @author George Marsaglia
*
* @see <a href="https://www.jstatsoft.org/article/view/v011i04/v11i04.pdf"> G. Marsaglia. Evaluating the normal distribution. Journal of Statistical Software, 11(4):1–11, 2004.</a>
* 
* @param {number} x a real number.
* @return {number} an approximation to the p value satisfying p = Pr{Z <= x} where Z is a random variable following a standard normal distribution law.
*
* @example
* normcdf(0);
* // 0.5
*/
export function normcdf(x: number) {
	// Initialisations
	var s = x;
	var t = 0;
	var b = x;
	var q = x * x;
	var i = 1;

	// The main loop corresponds to the computation of the Taylor serie of the function B around 0, c.f. page 5 of the reference.
	while (s != t) {
        i += 2;
        b *= q / i;
        t = s;
        s = s + b;
	}

	// The formula linking Phi and the Taylor expansion above if Phi = 1/2 + normal density * B, c.f. page 5 of the reference.
	return 0.5 + s * Math.exp(-0.5 * q - 0.91893853320467274178)
}