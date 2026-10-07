//! In-place iterative radix-2 FFT with precomputed tables, so repeated calls allocate nothing.

pub struct Fft {
    n: usize,
    rev: Vec<u32>,
    cos: Vec<f64>,
    sin: Vec<f64>,
}

impl Fft {
    pub fn new(n: usize) -> Self {
        assert!(n.is_power_of_two(), "FFT size must be a power of two");
        let bits = n.trailing_zeros();
        let rev = (0..n as u32).map(|i| if bits == 0 { 0 } else { i.reverse_bits() >> (32 - bits) }).collect();
        let cos = (0..n / 2).map(|i| (2.0 * std::f64::consts::PI * i as f64 / n as f64).cos()).collect();
        let sin = (0..n / 2).map(|i| -(2.0 * std::f64::consts::PI * i as f64 / n as f64).sin()).collect();
        Self { n, rev, cos, sin }
    }

    pub fn len(&self) -> usize {
        self.n
    }

    /// Forward transform when `inverse` is false; the inverse is unscaled (divide by n yourself).
    pub fn run(&self, re: &mut [f64], im: &mut [f64], inverse: bool) {
        let n = self.n;
        debug_assert!(re.len() == n && im.len() == n);
        for i in 0..n {
            let j = self.rev[i] as usize;
            if j > i {
                re.swap(i, j);
                im.swap(i, j);
            }
        }
        let sgn = if inverse { -1.0 } else { 1.0 };
        let mut size = 2;
        while size <= n {
            let half = size >> 1;
            let step = n / size;
            let mut start = 0;
            while start < n {
                for k in 0..half {
                    let wr = self.cos[k * step];
                    let wi = sgn * self.sin[k * step];
                    let a = start + k;
                    let b = a + half;
                    let xr = re[b] * wr - im[b] * wi;
                    let xi = re[b] * wi + im[b] * wr;
                    re[b] = re[a] - xr;
                    im[b] = im[a] - xi;
                    re[a] += xr;
                    im[a] += xi;
                }
                start += size;
            }
            size <<= 1;
        }
    }
}
