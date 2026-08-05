import random, sys
seed = int(sys.argv[1]) if len(sys.argv) > 1 else 0
random.seed(seed)

n = random.randint(2, 7)
k = random.randint(2, 4)
H = random.randint(1, n)                       # 层数 1..n

# 把 n 个点分到 0..H-1 层，每层至少 1 个
perm = list(range(n)); random.shuffle(perm)
layers = [[] for _ in range(H)]
for h in range(H):
    layers[h].append(perm[h])
for i in range(H, n):
    layers[random.randint(0, H - 1)].append(perm[i])

hof = [0] * n
for h, ls in enumerate(layers):
    for v in ls:
        hof[v] = h

ter = [0] * n
g = [[0] * k for _ in range(n)]
# 最高层必为终点（没有更高层可指）
for v in layers[H - 1]:
    ter[v] = 1
# 其他层：随机终点 / 普通点(出口指向 h+1 层)
for h in range(H - 1):
    for v in layers[h]:
        if random.random() < 0.3:
            ter[v] = 1
        else:
            for j in range(k):
                g[v][j] = random.choice(layers[h + 1])

q = random.randint(1, 6)
out = []
out.append(f"{n} {k} {q}")
out.append(" ".join(str(hof[i]) for i in range(n)))
for v in range(n):
    if ter[v]:
        out.append(" ".join(["0"] * k))
    else:
        out.append(" ".join(str(g[v][j] + 1) for j in range(k)))
for _ in range(q):
    x = random.randint(1, n); y = random.randint(1, n)
    pool = [1, 2, 3, 5, 1000000000]
    a = random.choice(pool); b = random.choice(pool)
    out.append(f"{x} {y} {a} {b}")
print("\n".join(out))
