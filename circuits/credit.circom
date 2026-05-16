// Credit verification circuit
// This circuit verifies that a user's credit score is above a threshold
// without revealing the actual credit score

template CreditVerification() {
    // Private inputs
    signal private input creditScore;
    signal private input threshold;

    // Public output
    signal output isValid;

    // Verify that credit score is greater than or equal to threshold
    isValid <-- (creditScore >= threshold) ? 1 : 0;
    isValid * (isValid - 1) === 0;
}

component main = CreditVerification();