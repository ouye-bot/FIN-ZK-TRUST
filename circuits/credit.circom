// Credit verification circuit
// 证明：我的信用分 >= 阈值 且 无逾期记录，但不暴露具体分数和逾期详情

// ==================== 基础组件 ====================

// 将信号分解为 N 位二进制（范围约束）
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

// 小于比较器：out = 1 当 in[0] < in[1]
template LessThan(n) {
    signal input in[2];
    signal output out;
    component n2b = Num2Bits(n + 1);
    n2b.in <== (1 << n) + in[0] - in[1];
    out <== 1 - n2b.out[n];
}

// 范围检查器：确保 in 在 [0, 2^n) 范围内
template RangeCheck(n) {
    signal input in;
    component n2b = Num2Bits(n);
    n2b.in <== in;
}

// 布尔检查器：确保 in 是 0 或 1
template BoolCheck() {
    signal input in;
    in * (in - 1) === 0;
}

// ==================== 主电路 ====================

template CreditVerification() {
    // 私有输入
    signal private input creditScore;   // 信用分（300-850）
    signal private input hasNoOverdue;  // 无逾期记录标志（0 或 1）

    // 公共输入
    signal input threshold;             // 阈值（由验证者提供）

    // 公共输出
    signal output isValid;              // 最终验证结果（0 或 1）

    // ---- 1. 输入范围约束 ----

    // creditScore 必须在 [0, 4095) 范围内（12 位足够表示 300-850）
    component scoreRange = RangeCheck(12);
    scoreRange.in <== creditScore;

    // hasNoOverdue 必须是布尔值（0 或 1）
    component overdueCheck = BoolCheck();
    overdueCheck.in <== hasNoOverdue;

    // threshold 也做范围约束
    component thresholdRange = RangeCheck(12);
    thresholdRange.in <== threshold;

    // ---- 2. 条件组合验证 ----

    // 条件 1：creditScore >= threshold
    component lt = LessThan(12);
    lt.in[0] <== creditScore;
    lt.in[1] <== threshold;
    signal scorePass;
    scorePass <== 1 - lt.out;  // 1 当 creditScore >= threshold

    // 组合：两个条件都满足才通过
    isValid <== scorePass * hasNoOverdue;
}

component main = CreditVerification();