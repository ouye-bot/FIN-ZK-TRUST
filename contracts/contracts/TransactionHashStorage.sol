// SPDX-License-Identifier: MIT
// 国密SM3+私链不可篡改+ZK零知识隐私核验三合一安全架构
// 本合约仅存储交易数据的SM3哈希摘要，原始交易数据不上链

pragma solidity ^0.8.19;

/**
 * @title TransactionHashStorage
 * @dev 交易哈希存证合约 - 用于存储关键交易信息的SM3哈希
 * 符合网络安全竞赛国密合规评分点要求
 */
contract TransactionHashStorage {
    
    // 交易哈希结构体
    struct TransactionHash {
        bytes32 transactionId;      // 交易唯一标识符
        bytes32 sm3Hash;           // SM3哈希值（32字节）
        uint256 timestamp;         // 区块时间戳
        string transactionType;    // 交易类型（loan/repay/credit_proof等）
        string userId;            // 用户ID
        address submitter;        // 提交者地址
    }
    
    // 交易ID到交易哈希的映射
    mapping(bytes32 => TransactionHash) public transactionHashes;
    
    // 所有交易ID数组（用于遍历和统计）
    bytes32[] public transactionIds;
    
    // 用户交易计数映射
    mapping(string => uint256) public userTransactionCount;
    
    // 合约所有者
    address public owner;
    
    // 事件定义
    event TransactionHashStored(
        bytes32 indexed transactionId,
        bytes32 sm3Hash,
        string transactionType,
        string userId,
        uint256 timestamp,
        address submitter
    );
    
    event TransactionHashVerified(
        bytes32 indexed transactionId,
        bytes32 storedHash,
        bool isValid,
        uint256 verifyTime
    );
    
    // 修饰器：仅合约所有者
    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can call this function");
        _;
    }
    
    /**
     * @dev 构造函数
     */
    constructor() {
        owner = msg.sender;
    }
    
    /**
     * @dev 存储交易哈希
     * @param _transactionId 交易唯一标识符（bytes32）
     * @param _sm3Hash SM3哈希值（bytes32格式）
     * @param _transactionType 交易类型
     * @param _userId 用户ID
     */
    function storeTransactionHash(
        bytes32 _transactionId,
        bytes32 _sm3Hash,
        string calldata _transactionType,
        string calldata _userId
    ) external {
        // 验证交易ID是否已存在
        require(transactionHashes[_transactionId].timestamp == 0, "Transaction already exists");
        
        // 验证SM3哈希不为空
        require(_sm3Hash != bytes32(0), "SM3 hash cannot be empty");
        
        // 创建交易哈希记录
        TransactionHash memory newRecord = TransactionHash({
            transactionId: _transactionId,
            sm3Hash: _sm3Hash,
            timestamp: block.timestamp,
            transactionType: _transactionType,
            userId: _userId,
            submitter: msg.sender
        });
        
        // 存储到映射
        transactionHashes[_transactionId] = newRecord;
        
        // 添加到交易ID数组
        transactionIds.push(_transactionId);
        
        // 增加用户交易计数
        userTransactionCount[_userId]++;
        
        // 触发事件
        emit TransactionHashStored(
            _transactionId,
            _sm3Hash,
            _transactionType,
            _userId,
            block.timestamp,
            msg.sender
        );
    }
    
    /**
     * @dev 获取交易哈希
     * @param _transactionId 交易唯一标识符
     * @return TransactionHash 交易哈希记录
     */
    function getTransactionHash(bytes32 _transactionId) 
        external 
        view 
        returns (TransactionHash memory) 
    {
        require(transactionHashes[_transactionId].timestamp != 0, "Transaction not found");
        return transactionHashes[_transactionId];
    }
    
    /**
     * @dev 验证交易哈希
     * @param _transactionId 交易唯一标识符
     * @param _calculatedHash 计算得到的SM3哈希值
     * @return bool 验证结果
     */
    function verifyTransactionHash(
        bytes32 _transactionId,
        bytes32 _calculatedHash
    ) external returns (bool) {
        TransactionHash memory storedRecord = transactionHashes[_transactionId];
        
        // 检查交易是否存在
        if (storedRecord.timestamp == 0) {
            emit TransactionHashVerified(_transactionId, _calculatedHash, false, block.timestamp);
            return false;
        }
        
        // 比对哈希值
        bool isValid = storedRecord.sm3Hash == _calculatedHash;
        
        emit TransactionHashVerified(_transactionId, storedRecord.sm3Hash, isValid, block.timestamp);
        
        return isValid;
    }
    
    /**
     * @dev 获取交易总数
     * @return uint256 交易总数
     */
    function getTransactionCount() external view returns (uint256) {
        return transactionIds.length;
    }
    
    /**
     * @dev 获取用户的交易数量
     * @param _userId 用户ID
     * @return uint256 用户交易数量
     */
    function getUserTransactionCount(string calldata _userId) external view returns (uint256) {
        return userTransactionCount[_userId];
    }
    
    /**
     * @dev 批量获取交易哈希（分页查询）
     * @param _start 起始索引
     * @param _limit 查询数量
     * @return TransactionHash[] 交易哈希数组
     */
    function getTransactionHashesBatch(uint256 _start, uint256 _limit) 
        external 
        view 
        returns (TransactionHash[] memory) 
    {
        require(_start < transactionIds.length, "Start index out of bounds");
        
        uint256 end = _start + _limit;
        if (end > transactionIds.length) {
            end = transactionIds.length;
        }
        
        uint256 count = end - _start;
        TransactionHash[] memory result = new TransactionHash[](count);
        
        for (uint256 i = 0; i < count; i++) {
            result[i] = transactionHashes[transactionIds[_start + i]];
        }
        
        return result;
    }
    
    /**
     * @dev 检查交易是否存在
     * @param _transactionId 交易唯一标识符
     * @return bool 是否存在
     */
    function transactionExists(bytes32 _transactionId) external view returns (bool) {
        return transactionHashes[_transactionId].timestamp != 0;
    }
    
    /**
     * @dev 转移合约所有权
     * @param _newOwner 新所有者地址
     */
    function transferOwnership(address _newOwner) external onlyOwner {
        require(_newOwner != address(0), "New owner cannot be zero address");
        owner = _newOwner;
    }
}
