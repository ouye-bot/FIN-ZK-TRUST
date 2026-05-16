import { CacheManager, CreditProofCache, UserDataCache } from '../cacheUtils';

// 模拟localStorage
const mockLocalStorage = (() => {
  let store = {};
  return {
    getItem: jest.fn(key => store[key] || null),
    setItem: jest.fn((key, value) => {
      store[key] = value.toString();
    }),
    removeItem: jest.fn(key => {
      delete store[key];
    }),
    clear: jest.fn(() => {
      store = {};
    })
  };
})();

Object.defineProperty(window, 'localStorage', { value: mockLocalStorage });

describe('CacheManager', () => {
  let cacheManager;

  beforeEach(() => {
    // 清除localStorage模拟数据
    mockLocalStorage.clear();
    cacheManager = new CacheManager('test-cache', 5);
  });

  test('should set and get item', () => {
    const key = 'test-key';
    const value = { data: 'test-data' };
    
    cacheManager.set(key, value);
    const retrievedValue = cacheManager.get(key);
    
    expect(retrievedValue).toEqual(value);
  });

  test('should return null for non-existent item', () => {
    const retrievedValue = cacheManager.get('non-existent-key');
    expect(retrievedValue).toBeNull();
  });

  test('should remove item', () => {
    const key = 'test-key';
    const value = { data: 'test-data' };
    
    cacheManager.set(key, value);
    cacheManager.remove(key);
    const retrievedValue = cacheManager.get(key);
    
    expect(retrievedValue).toBeNull();
  });

  test('should clear all items', () => {
    cacheManager.set('key1', { data: 'data1' });
    cacheManager.set('key2', { data: 'data2' });
    
    cacheManager.clear();
    
    expect(cacheManager.get('key1')).toBeNull();
    expect(cacheManager.get('key2')).toBeNull();
  });

  test('should handle cache overflow', () => {
    // 添加6个项目，超过容量5
    for (let i = 0; i < 6; i++) {
      cacheManager.set(`key${i}`, { data: `data${i}` });
    }
    
    // 第一个项目应该被淘汰
    expect(cacheManager.get('key0')).toBeNull();
    // 其他项目应该存在
    for (let i = 1; i < 6; i++) {
      expect(cacheManager.get(`key${i}`)).toEqual({ data: `data${i}` });
    }
  });

  test('should handle expired items', () => {
    // 创建一个过期时间为1毫秒的项目
    const key = 'test-key';
    const value = { data: 'test-data' };
    
    cacheManager.set(key, value, 1);
    
    // 等待2毫秒，确保项目过期
    return new Promise(resolve => {
      setTimeout(() => {
        const retrievedValue = cacheManager.get(key);
        expect(retrievedValue).toBeNull();
        resolve();
      }, 2);
    });
  });
});

describe('CreditProofCache', () => {
  let creditProofCache;

  beforeEach(() => {
    mockLocalStorage.clear();
    creditProofCache = new CreditProofCache();
  });

  test('should set and get credit proof', () => {
    const proofId = 'proof-123';
    const proof = {
      id: proofId,
      userId: 'user-123',
      creditScore: 750,
      verificationCode: 'code-123',
      timestamp: Date.now(),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000
    };
    
    creditProofCache.setCreditProof(proof);
    const retrievedProof = creditProofCache.getCreditProof(proofId);
    
    expect(retrievedProof).toEqual(proof);
  });

  test('should return null for non-existent proof', () => {
    const retrievedProof = creditProofCache.getCreditProof('non-existent-proof');
    expect(retrievedProof).toBeNull();
  });

  test('should remove credit proof', () => {
    const proofId = 'proof-123';
    const proof = {
      id: proofId,
      userId: 'user-123',
      creditScore: 750,
      verificationCode: 'code-123',
      timestamp: Date.now(),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000
    };
    
    creditProofCache.setCreditProof(proof);
    creditProofCache.removeCreditProof(proofId);
    const retrievedProof = creditProofCache.getCreditProof(proofId);
    
    expect(retrievedProof).toBeNull();
  });

  test('should clear all credit proofs', () => {
    const proof1 = {
      id: 'proof-123',
      userId: 'user-123',
      creditScore: 750,
      verificationCode: 'code-123',
      timestamp: Date.now(),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000
    };
    
    const proof2 = {
      id: 'proof-456',
      userId: 'user-456',
      creditScore: 800,
      verificationCode: 'code-456',
      timestamp: Date.now(),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000
    };
    
    creditProofCache.setCreditProof(proof1);
    creditProofCache.setCreditProof(proof2);
    creditProofCache.clear();
    
    expect(creditProofCache.getCreditProof('proof-123')).toBeNull();
    expect(creditProofCache.getCreditProof('proof-456')).toBeNull();
  });
});

describe('UserDataCache', () => {
  let userDataCache;

  beforeEach(() => {
    mockLocalStorage.clear();
    userDataCache = new UserDataCache();
  });

  test('should set and get user data', () => {
    const userId = 'user-123';
    const userData = {
      id: userId,
      name: 'Test User',
      balance: 1000,
      creditScore: 750
    };
    
    userDataCache.setUserData(userData);
    const retrievedData = userDataCache.getUserData(userId);
    
    expect(retrievedData).toEqual(userData);
  });

  test('should return null for non-existent user', () => {
    const retrievedData = userDataCache.getUserData('non-existent-user');
    expect(retrievedData).toBeNull();
  });

  test('should remove user data', () => {
    const userId = 'user-123';
    const userData = {
      id: userId,
      name: 'Test User',
      balance: 1000,
      creditScore: 750
    };
    
    userDataCache.setUserData(userData);
    userDataCache.removeUserData(userId);
    const retrievedData = userDataCache.getUserData(userId);
    
    expect(retrievedData).toBeNull();
  });

  test('should clear all user data', () => {
    const user1 = {
      id: 'user-123',
      name: 'Test User 1',
      balance: 1000,
      creditScore: 750
    };
    
    const user2 = {
      id: 'user-456',
      name: 'Test User 2',
      balance: 2000,
      creditScore: 800
    };
    
    userDataCache.setUserData(user1);
    userDataCache.setUserData(user2);
    userDataCache.clear();
    
    expect(userDataCache.getUserData('user-123')).toBeNull();
    expect(userDataCache.getUserData('user-456')).toBeNull();
  });
});
