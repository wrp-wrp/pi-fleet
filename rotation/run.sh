#!/bin/bash
cd "$(dirname "$0")"
g++ -O2 -std=c++17 -o brute brute.cpp || exit 1
FAIL=0
for s in $(seq 1 3000); do
  python3 gen.py "$s" > rotation.in
  ./sol
  ./brute
  if ! diff -q rotation.out brute.out > /dev/null; then
    echo "=== MISMATCH at seed $s ==="
    echo "--- input ---"; cat rotation.in
    echo "--- sol ---"; cat rotation.out
    echo "--- brute ---"; cat brute.out
    FAIL=1
    break
  fi
done
[ "$FAIL" = "0" ] && echo "ALL 3000 CASES PASSED ✓"
