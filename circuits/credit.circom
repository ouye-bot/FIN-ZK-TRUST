// Credit verification circuit
// This circuit verifies that a user's credit score is above a threshold
// without revealing the actual credit score

// 内联 Num2Bits 实现，不依赖 circomlib（兼容旧版 circom 编译器）
template Num2Bits(n) {
    signal input in;
    signal output out[n];
    var lc1 = 0;
    for (var i = 0; i < n; i++) {
        out[i] <-- (in >> i) & 1;
        out[i] * (out[i] - 1) === 0;
        lc1 += out[i] * (1 << i);
    }
    lc1 === in;
}

// 内联 LessThan 模板，进行约束化比较
template LessThan(n) {
    signal input in[2];
    signal output out;

    component n2b = Num2Bits(n + 1);

    n2b.in <== (1 << n) + in[0] - in[1];

    out <== 1 - n2b.out[n];
}

template CreditVerification() {
    // Private inputs
    signal private input creditScore;
    signal private input threshold;

    // Public output
    signal output isValid;

    // 使用 LessThan 模板进行约束化比较（12位足够 0-4095 范围）
    component lt = LessThan(12);

    lt.in[0] <== creditScore;
    lt.in[1] <== threshold;

    // isValid = 1 当 creditScore >= threshold（即 NOT (creditScore < threshold)）
    isValid <== 1 - lt.out;
}

component main = CreditVerification();