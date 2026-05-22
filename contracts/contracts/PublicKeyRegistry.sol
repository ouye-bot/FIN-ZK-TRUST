// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract PublicKeyRegistry {
    struct PublicKeyRecord {
        bytes32 pkHash;      // SM3(publicKey)
        string  publicKey;   // 完整 SM2 公钥 (04开头, 130字符hex)
        uint256 timestamp;
        uint256 version;     // 密钥版本号，每次更新+1
        bool    active;
    }

    address public owner;
    mapping(address => bool) public authorizedOperators;

    // userId => PublicKeyRecord[]
    mapping(string => PublicKeyRecord[]) private records;

    event PublicKeyRegistered(string userId, bytes32 indexed pkHash, uint256 version, uint256 timestamp);
    event PublicKeyRevoked(string userId, bytes32 indexed pkHash, uint256 version);
    event OperatorAuthorized(address indexed operator);
    event OperatorRevoked(address indexed operator);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier onlyAuthorized() {
        require(msg.sender == owner || authorizedOperators[msg.sender], "Not authorized");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function authorizeOperator(address op) external onlyOwner {
        require(op != address(0), "Zero address");
        authorizedOperators[op] = true;
        emit OperatorAuthorized(op);
    }

    function revokeOperator(address op) external onlyOwner {
        authorizedOperators[op] = false;
        emit OperatorRevoked(op);
    }

    /**
     * 注册公钥（自动撤销旧密钥）
     * @param userId 用户ID
     * @param pkHash SM3(publicKey)
     * @param publicKey 完整SM2公钥
     */
    function register(
        string calldata userId,
        bytes32 pkHash,
        string calldata publicKey
    ) external onlyAuthorized returns (uint256 version) {
        require(bytes(publicKey).length > 0, "Empty public key");

        // 撤销所有旧密钥
        PublicKeyRecord[] storage recs = records[userId];
        for (uint i = 0; i < recs.length; i++) {
            if (recs[i].active) {
                recs[i].active = false;
                emit PublicKeyRevoked(userId, recs[i].pkHash, recs[i].version);
            }
        }

        // 注册新密钥
        version = recs.length + 1;
        recs.push(PublicKeyRecord({
            pkHash: pkHash,
            publicKey: publicKey,
            timestamp: block.timestamp,
            version: version,
            active: true
        }));

        emit PublicKeyRegistered(userId, pkHash, version, block.timestamp);
    }

    /**
     * 撤销指定公钥
     */
    function revoke(string calldata userId, bytes32 pkHash) external onlyAuthorized {
        PublicKeyRecord[] storage recs = records[userId];
        for (uint i = 0; i < recs.length; i++) {
            if (recs[i].active && recs[i].pkHash == pkHash) {
                recs[i].active = false;
                emit PublicKeyRevoked(userId, pkHash, recs[i].version);
                return;
            }
        }
        revert("Key not found or already revoked");
    }

    /**
     * 获取当前活跃公钥
     */
    function getActiveKey(string calldata userId)
        external view returns (PublicKeyRecord memory)
    {
        PublicKeyRecord[] storage recs = records[userId];
        for (uint i = recs.length; i > 0; i--) {
            if (recs[i - 1].active) return recs[i - 1];
        }
        revert("No active key");
    }

    /**
     * 获取公钥历史
     */
    function getKeyHistory(string calldata userId)
        external view returns (PublicKeyRecord[] memory)
    {
        return records[userId];
    }

    /**
     * 获取公钥历史长度
     */
    function getKeyHistoryLength(string calldata userId)
        external view returns (uint256)
    {
        return records[userId].length;
    }
}
