#include <cstdio>
#include <vector>
#include <array>
#include <algorithm>
#include <numeric>
#include <climits>
using namespace std;
typedef long long ll;

const int LOG = 20;

int n, k, q;
vector<int> hh;
vector<char> ter;
vector<vector<int>> g;
vector<int> ST;
vector<int> TRM;
vector<array<int, LOG>> upF;

inline int nxt(int u, int p) { return ter[u] ? u : g[u][p]; }

int walk(int u, ll m) {
    if (m >= ST[u*k]) return TRM[u*k];
    ll qq = m / k; int r = int(m % k);
    for (int j = 0; j < LOG; j++)
        if ((qq >> j) & 1) u = upF[u][j];
    for (int i = 0; i < r; i++) u = nxt(u, i);
    return u;
}

int firstRinBlock(int u, int v) {
    if (u == v) return 0;
    int pu = u, pv = v;
    for (int r = 0; r + 1 < k; r++) {
        pu = nxt(pu, r); pv = nxt(pv, r);
        if (pu == pv) return r + 1;
    }
    return -1;
}
inline bool mergeable(int u, int v) { return firstRinBlock(u, v) >= 0; }

int main() {
    freopen("rotation.in", "r", stdin);
    freopen("rotation.out", "w", stdout);
    scanf("%d%d%d", &n, &k, &q);
    hh.resize(n); ter.assign(n, 0); g.assign(n, vector<int>(k, 0));
    for (int i = 0; i < n; i++) scanf("%d", &hh[i]);
    for (int i = 0; i < n; i++) {
        bool all0 = true; vector<int> row(k);
        for (int j = 0; j < k; j++) { scanf("%d", &row[j]); if (row[j]) all0 = false; }
        if (all0) ter[i] = 1;
        else for (int j = 0; j < k; j++) g[i][j] = row[j] - 1;
    }

    vector<int> ord(n); iota(ord.begin(), ord.end(), 0);
    sort(ord.begin(), ord.end(), [&](int a, int b){ return hh[a] > hh[b]; });
    ST.assign(n*k, 0); TRM.assign(n*k, -1);
    for (int u : ord) {
        if (ter[u]) { for (int p = 0; p < k; p++) { ST[u*k+p] = 0; TRM[u*k+p] = u; } }
        else for (int p = 0; p < k; p++) {
            int v = g[u][p], np = (p + 1) % k;
            ST[u*k+p]  = ST[v*k+np] + 1;
            TRM[u*k+p] = TRM[v*k+np];
        }
    }

    upF.assign(n, {});
    for (int u = 0; u < n; u++) {
        int cur = u;
        for (int r = 0; r < k; r++) cur = nxt(cur, r);
        upF[u][0] = cur;
    }
    for (int j = 1; j < LOG; j++)
        for (int u = 0; u < n; u++)
            upF[u][j] = upF[ upF[u][j-1] ][j-1];

    while (q--) {
        int x, y; ll a, b;
        scanf("%d%d%lld%lld", &x, &y, &a, &b);
        x--; y--;
        ll ans = LLONG_MAX;
        if (x == y) ans = 0;
        else if (a == b) {
            if (TRM[x*k] != TRM[y*k]) ans = -1;
            else {
                ll m0;
                int r0 = firstRinBlock(x, y);
                if (r0 >= 0) m0 = r0;
                else {
                    int ux = x, uy = y; ll cur = 0;
                    for (int j = LOG-1; j >= 0; j--) {
                        int ax = upF[ux][j], ay = upF[uy][j];
                        if (!mergeable(ax, ay)) { cur += (1LL<<j); ux = ax; uy = ay; }
                    }
                    ux = upF[ux][0]; uy = upF[uy][0];
                    m0 = (cur + 1) * k + firstRinBlock(ux, uy);
                }
                ans = (m0 + a - 1) / a;
            }
        } else {
            ll N = (ll)hh[y] - hh[x], D = a - b;
            if (N % D == 0) {
                ll t = N / D;
                if (t >= 0 && walk(x, a*t) == walk(y, b*t)) ans = min(ans, t);
            }
            if (TRM[x*k] == TRM[y*k]) {
                ll t = max( (ll)(ST[x*k] + a - 1) / a, (ll)(ST[y*k] + b - 1) / b );
                if (walk(x, a*t) == walk(y, b*t)) ans = min(ans, t);
            }
            if (ans == LLONG_MAX) ans = -1;
        }
        printf("%lld\n", ans);
    }
    return 0;
}
