// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./Verifier.sol";

contract FinZkTrust is Ownable, ReentrancyGuard, AccessControl {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    // Structs
    struct UserInfo {
        bytes sm2PublicKey;
        uint256 creditScore;
        uint256 loanLimit;
        bool isInitialized;
    }

    struct Loan {
        address borrower;
        uint256 amount;
        uint256 interestRate;
        uint256 startTime;
        uint256 duration;
        bool isActive;
        bool isRepaid;
    }

    struct Investment {
        address investor;
        uint256 amount;
        uint256 startTime;
        uint256 term;
        bool isActive;
    }

    struct Transaction {
        address user;
        uint256 amount;
        uint256 timestamp;
        string transactionType;
    }

    // State variables
    Verifier public verifier;
    mapping(address => UserInfo) public userInfos;
    mapping(address => Loan[]) public borrowerLoans;
    mapping(address => Investment[]) public investorInvestments;
    mapping(bytes32 => bool) public transactionHashes;
    Transaction[] public transactions;
    
    // Pools
    uint256 public originalPoolBalance;
    uint256 public userPoolBalance;
    
    // Constants
    uint256 public constant MIN_INVESTMENT_AMOUNT = 100 * 10**18; // 100 tokens
    uint256 public constant MIN_CREDIT_SCORE = 600;
    uint256 public constant MAX_LOAN_AMOUNT = 1000000 * 10**18; // 1M tokens
    uint256 public constant MIN_LOAN_DURATION = 30 days;
    uint256 public constant MAX_LOAN_DURATION = 365 days;
    uint256 public constant ZK_PROOF_EXPIRY = 24 hours;
    
    // Interest rate ranges based on credit score
    uint256 public constant HIGH_CREDIT_THRESHOLD = 800;
    uint256 public constant MEDIUM_CREDIT_THRESHOLD = 700;
    uint256 public constant LOW_INTEREST_RATE = 4; // 4% APR
    uint256 public constant MEDIUM_INTEREST_RATE = 6; // 6% APR
    uint256 public constant HIGH_INTEREST_RATE = 8; // 8% APR

    // Events
    event UserInitialized(address indexed user, bytes sm2PublicKey, uint256 creditScore, uint256 loanLimit);
    event LoanCreated(address indexed borrower, uint256 amount, uint256 duration, uint256 interestRate);
    event LoanRepaid(address indexed borrower, uint256 amount);
    event InvestmentCreated(address indexed investor, uint256 amount, uint256 term);
    event InvestmentRedeemed(address indexed investor, uint256 amount, uint256 interest);
    event TransactionHashRecorded(bytes32 indexed hash, address indexed user, string transactionType);
    event PoolDeposited(address indexed depositor, uint256 amount, string poolType);
    event SystemBalanceUpdated(uint256 originalPool, uint256 userPool);

    constructor(address _verifierAddress) {
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _setupRole(ADMIN_ROLE, msg.sender);
        verifier = Verifier(_verifierAddress);
        originalPoolBalance = 10000 * 10**18; // Initial original pool balance: 10000 tokens
        userPoolBalance = 0; // Initial user pool balance: 0
    }

    // Modifiers
    modifier onlyAdmin() {
        require(hasRole(ADMIN_ROLE, msg.sender), "Caller is not an admin");
        _;
    }

    modifier userInitialized() {
        require(userInfos[msg.sender].isInitialized, "User not initialized");
        _;
    }

    modifier validLoanAmount(uint256 amount) {
        require(amount > 0 && amount <= MAX_LOAN_AMOUNT, "Invalid loan amount");
        _;
    }

    modifier validLoanDuration(uint256 duration) {
        require(
            duration >= MIN_LOAN_DURATION && duration <= MAX_LOAN_DURATION,
            "Invalid loan duration"
        );
        _;
    }

    modifier validInvestmentAmount(uint256 amount) {
        require(amount >= MIN_INVESTMENT_AMOUNT, "Investment amount too small");
        _;
    }

    // Functions
    function initializeUser(bytes calldata _sm2PublicKey, uint256 _creditScore) external onlyAdmin {
        require(_sm2PublicKey.length > 0, "SM2 public key cannot be empty");
        require(_creditScore >= 0 && _creditScore <= 1000, "Invalid credit score");
        
        uint256 loanLimit = calculateLoanLimit(_creditScore);
        
        userInfos[msg.sender] = UserInfo({
            sm2PublicKey: _sm2PublicKey,
            creditScore: _creditScore,
            loanLimit: loanLimit,
            isInitialized: true
        });
        
        emit UserInitialized(msg.sender, _sm2PublicKey, _creditScore, loanLimit);
    }

    function depositToPool(uint256 amount) external payable nonReentrant onlyAdmin {
        require(amount > 0, "Amount must be greater than 0");
        require(msg.value >= amount, "Insufficient funds");
        
        originalPoolBalance += amount;
        emit PoolDeposited(msg.sender, amount, "ORIGINAL_POOL");
        emit SystemBalanceUpdated(originalPoolBalance, userPoolBalance);
    }

    function invest(uint256 amount, uint256 term) 
        external 
        payable 
        nonReentrant 
        userInitialized 
        validInvestmentAmount(amount)
    {
        require(msg.value >= amount, "Insufficient funds");
        
        Investment memory newInvestment = Investment({
            investor: msg.sender,
            amount: amount,
            startTime: block.timestamp,
            term: term,
            isActive: true
        });

        investorInvestments[msg.sender].push(newInvestment);
        userPoolBalance += amount;
        
        emit InvestmentCreated(msg.sender, amount, term);
        emit SystemBalanceUpdated(originalPoolBalance, userPoolBalance);
    }

    function borrow(
        uint256 amount,
        uint256 duration,
        uint256[2] memory proofA,
        uint256[2][2] memory proofB,
        uint256[2] memory proofC,
        uint256[1] memory proofInput,
        bytes32 sm3Hash
    ) 
        external 
        nonReentrant 
        userInitialized 
        validLoanAmount(amount) 
        validLoanDuration(duration)
    {
        UserInfo storage userInfo = userInfos[msg.sender];
        require(userInfo.creditScore >= MIN_CREDIT_SCORE, "Insufficient credit score");
        require(amount <= userInfo.loanLimit, "Loan amount exceeds limit");
        
        // Verify zero-knowledge proof
        bool proofValid = verifier.verifyProof(
            msg.sender,
            proofA,
            proofB,
            proofC,
            proofInput,
            sm3Hash
        );
        require(proofValid, "Invalid zero-knowledge proof");
        
        // Check pool balance
        uint256 totalPoolBalance = originalPoolBalance + userPoolBalance;
        require(amount <= totalPoolBalance, "Insufficient pool balance");
        
        uint256 interestRate = calculateInterestRate(userInfo.creditScore);
        
        Loan memory newLoan = Loan({
            borrower: msg.sender,
            amount: amount,
            interestRate: interestRate,
            startTime: block.timestamp,
            duration: duration,
            isActive: true,
            isRepaid: false
        });

        borrowerLoans[msg.sender].push(newLoan);
        
        // Deduct from pools (priority: user pool first)
        if (amount <= userPoolBalance) {
            userPoolBalance -= amount;
        } else {
            uint256 userPoolAmount = userPoolBalance;
            userPoolBalance = 0;
            originalPoolBalance -= (amount - userPoolAmount);
        }
        
        emit LoanCreated(msg.sender, amount, duration, interestRate);
        emit SystemBalanceUpdated(originalPoolBalance, userPoolBalance);
    }

    function redeem(uint256 amount) external nonReentrant userInitialized {
        require(amount > 0, "Amount must be greater than 0");
        
        Investment[] storage investments = investorInvestments[msg.sender];
        require(investments.length > 0, "No investments found");
        
        uint256 totalRedeemable = 0;
        uint256 totalInterest = 0;
        
        // Calculate total redeemable amount (interest + principal)
        for (uint i = 0; i < investments.length; i++) {
            if (investments[i].isActive) {
                uint256 interest = calculateInvestmentInterest(investments[i]);
                totalRedeemable += investments[i].amount + interest;
                totalInterest += interest;
            }
        }
        
        require(amount <= totalRedeemable, "Amount exceeds redeemable balance");
        
        uint256 remainingAmount = amount;
        
        // Redeem in order: interest first, then non-today principal, then today principal
        for (uint i = 0; i < investments.length && remainingAmount > 0; i++) {
            Investment storage investment = investments[i];
            if (investment.isActive) {
                uint256 interest = calculateInvestmentInterest(investment);
                
                // Redeem interest first
                if (interest > 0) {
                    uint256 interestRedeem = Math.min(remainingAmount, interest);
                    remainingAmount -= interestRedeem;
                    totalInterest -= interestRedeem;
                }
                
                // Redeem principal if needed
                if (remainingAmount > 0) {
                    uint256 principalRedeem = Math.min(remainingAmount, investment.amount);
                    remainingAmount -= principalRedeem;
                    investment.amount -= principalRedeem;
                    
                    if (investment.amount == 0) {
                        investment.isActive = false;
                    }
                }
            }
        }
        
        userPoolBalance -= (amount - totalInterest);
        
        emit InvestmentRedeemed(msg.sender, amount, totalInterest);
        emit SystemBalanceUpdated(originalPoolBalance, userPoolBalance);
    }

    function recordTransactionHash(bytes32 hash, string calldata transactionType) external nonReentrant userInitialized {
        require(hash != bytes32(0), "Hash cannot be empty");
        require(!transactionHashes[hash], "Hash already recorded");
        
        transactionHashes[hash] = true;
        emit TransactionHashRecorded(hash, msg.sender, transactionType);
    }

    function calculateLoanLimit(uint256 creditScore) public pure returns (uint256) {
        if (creditScore >= 900) {
            return 50000 * 10**18; // 50,000 tokens
        } else if (creditScore >= 800) {
            return 20000 * 10**18; // 20,000 tokens
        } else if (creditScore >= 700) {
            return 10000 * 10**18; // 10,000 tokens
        } else if (creditScore >= 600) {
            return 5000 * 10**18; // 5,000 tokens
        } else {
            return 0;
        }
    }

    function calculateInterestRate(uint256 creditScore) public pure returns (uint256) {
        if (creditScore >= HIGH_CREDIT_THRESHOLD) {
            return LOW_INTEREST_RATE;
        } else if (creditScore >= MEDIUM_CREDIT_THRESHOLD) {
            return MEDIUM_INTEREST_RATE;
        } else {
            return HIGH_INTEREST_RATE;
        }
    }

    function calculateInvestmentInterest(Investment memory investment) public view returns (uint256) {
        uint256 timeElapsed = block.timestamp - investment.startTime;
        uint256 interestRate = 8; // 8% APR for investments
        return (investment.amount * interestRate * timeElapsed) / (365 days * 100);
    }

    function getUserInfo(address user) external view returns (UserInfo memory) {
        return userInfos[user];
    }

    function getInvestorInvestments(address investor) external view returns (Investment[] memory) {
        return investorInvestments[investor];
    }

    function getPoolBalances() external view returns (uint256, uint256) {
        return (originalPoolBalance, userPoolBalance);
    }

    function isTransactionHashRecorded(bytes32 hash) external view returns (bool) {
        return transactionHashes[hash];
    }
}

 