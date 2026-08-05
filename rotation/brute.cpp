#include <cstdio>
#include <vector>
using namespace std;
typedef long long ll;
int n,k,q;
vector<int> hh; vector<char> ter; vector<vector<int>> g;

// 暴力：从 u 出发(指针0)走 m 步，终点后停
int walk(int u, ll m){
    int p=0;
    for(ll i=0;i<m;i++){
        if(ter[u]) break;
        u=g[u][p]; p=(p+1)%k;
    }
    return u;
}
int main(){
    freopen("rotation.in","r",stdin);
    freopen("brute.out","w",stdout);
    scanf("%d%d%d",&n,&k,&q);
    hh.resize(n); ter.assign(n,0); g.assign(n,vector<int>(k,0));
    for(int i=0;i<n;i++) scanf("%d",&hh[i]);
    for(int i=0;i<n;i++){
        bool all0=true; vector<int> row(k);
        for(int j=0;j<k;j++){scanf("%d",&row[j]); if(row[j]) all0=false;}
        if(all0) ter[i]=1; else for(int j=0;j<k;j++) g[i][j]=row[j]-1;
    }
    while(q--){
        int x,y; ll a,b; scanf("%d%d%lld%lld",&x,&y,&a,&b); x--;y--;
        ll ans=-1;
        // t 上界：双方都停稳后位置恒定，T0<=n；多扫到 n+5 保险
        for(ll t=0;t<=n+5;t++){
            if(walk(x, a*t)==walk(y, b*t)){ ans=t; break;}
        }
        printf("%lld\n", ans);
    }
    return 0;
}
