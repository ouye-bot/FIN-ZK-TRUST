import React, { useState, useEffect, useRef, createContext, useContext } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { post, put, get } from './utils/apiUtils';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import Box from '@mui/material/Box';
import Navbar from './components/Navbar';
import CryptoLogPanel from './components/CryptoLogPanel';
import ErrorBoundary from './components/ErrorBoundary';
import Home from './pages/Home';
import Borrow from './pages/Borrow';
import Profile from './pages/Profile';
import CreditProof from './pages/CreditProof';
import Account from './pages/Account';
import FundPoolPage from './pages/FundPoolPage';
import InvestPage from './pages/InvestPage';
import RedeemPage from './pages/RedeemPage';
import MyInvestPage from './pages/MyInvestPage';
import MfaSetup from './pages/MfaSetup';
import MfaVerify from './pages/MfaVerify';
import BlockchainExplorer from './pages/BlockchainExplorer';
import { UserDataCache } from './utils/cacheUtils';
import { syncLogToBackend } from './utils/logUtils';
import { getDeviceKey } from './utils/deviceKeyManager';
import { encryptPrivateKey, decryptPrivateKey, deriveKey } from './utils/secureKeyStore';
import { getSM2KeyPair, saveSM2KeyPair, getSM2KeyPairWithAesKey, signWithSM2 } from './utils/sm2Utils';
import { preloadZkWorker, terminateZkWorker } from './utils/zkWorkerPool';

// 模块级密钥存储，确保签名处理器立即获取，避免 React 状态异步
let globalAesKey = null;

// 签名请求事件名
const SIGN_REQUEST_EVENT = 'finzktrust:sign-request';
const SIGN_RESPONSE_EVENT = 'finzktrust:sign-response';

// 创建AES密钥Context
export const AesKeyContext = createContext(null);

// 自定义Hook，用于获取AES密钥
export const useAesKey = () => {
  const context = useContext(AesKeyContext);
  if (context === undefined) {
    console.warn('useAesKey: AesKeyContext not provided, returning null');
    return null;
  }
  return context;
};

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#0f172a',
      light: '#1e293b',
      dark: '#020617',
    },
    secondary: {
      main: '#3b82f6',
      light: '#60a5fa',
      dark: '#2563eb',
    },
    background: {
      default: '#f8fafc',
      paper: '#ffffff',
    },
    text: {
      primary: '#0f172a',
      secondary: '#64748b',
    },
    divider: '#e2e8f0',
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h1: {
      fontWeight: 700,
      letterSpacing: '-0.025em',
    },
    h2: {
      fontWeight: 600,
      letterSpacing: '-0.025em',
    },
    h3: {
      fontWeight: 600,
      letterSpacing: '-0.025em',
    },
    h4: {
      fontWeight: 600,
      letterSpacing: '-0.025em',
    },
    h5: {
      fontWeight: 600,
      letterSpacing: '-0.025em',
    },
    h6: {
      fontWeight: 600,
      letterSpacing: '-0.025em',
    },
    body1: {
      letterSpacing: '0.00938em',
    },
    body2: {
      letterSpacing: '0.00938em',
    },
  },
  shape: {
    borderRadius: 8,
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          textTransform: 'none',
          fontWeight: 500,
          padding: '0.5rem 1.5rem',
        },
        contained: {
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
          '&:hover': {
            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
          },
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
          transition: 'all 0.3s ease',
          '&:hover': {
            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
            transform: 'translateY(-2px)',
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            borderRadius: 8,
          },
        },
      },
    },
  },
});

// 验证用户登录状态
const verifyLoginStatus = () => {
  const userStr = localStorage.getItem('user');
  const tokenStr = localStorage.getItem('token');
  if (!userStr || !tokenStr) {
    return null;
  }
  
  try {
    const user = JSON.parse(userStr);
    // 检查用户信息是否有效
    // 可以添加过期检查逻辑
    return user;
  } catch (error) {
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    return null;
  }
};

function App() {
  const [user, setUser] = useState(null);
  const [error, setError] = useState('');
  const [cryptoLogs, setCryptoLogs] = useState([]);
  const [logPanelVisible, setLogPanelVisible] = useState(false);
  const [aesKey, setAesKey] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // 初始化：检查是否有 MFA 暂存数据
  useEffect(() => {
    // 检查是否有 MFA 验证成功后的暂存数据
    const mfaAuthStr = sessionStorage.getItem('mfa_auth');
    if (mfaAuthStr) {
      try {
        const mfaAuth = JSON.parse(mfaAuthStr);
        // 清理暂存
        sessionStorage.removeItem('mfa_auth');

        // 恢复用户状态
        localStorage.setItem('token', mfaAuth.token);
        localStorage.setItem('user', JSON.stringify(mfaAuth.user));
        // 延迟执行，避开 React 同步渲染中的 Portal 清理冲突
        setTimeout(() => setUser(mfaAuth.user), 10);

        // 恢复设备主密钥
        if (mfaAuth.sessionKey) {
          setTimeout(() => {
            getDeviceKey(mfaAuth.sessionKey).then(deviceKey => {
              setAesKey(deviceKey);
              globalAesKey = deviceKey;
              console.log('MFA: 设备主密钥恢复成功（页面刷新后）');
            }).catch(err => {
              console.error('MFA: 设备主密钥恢复失败:', err);
            });
          }, 20); // 稍晚于 user 设置
        }
      } catch (err) {
        console.error('MFA 认证数据恢复失败:', err);
        sessionStorage.removeItem('mfa_auth');
        setUser(null);
      }
    } else {
      // 没有 MFA 暂存数据，按原逻辑清除登录态
      setUser(null);
    }
    setIsLoading(false);
  }, []);

  // 监听 MFA 验证成功事件
  useEffect(() => {
    const handleMfaVerified = (e) => {
      const { user, sessionKey } = e.detail;
      
      // 延迟设置 user，避免与 React 同步渲染中的 Portal 清理冲突
      setTimeout(() => {
        setUser(user);
        
        if (sessionKey) {
          // 密钥恢复在 user 设置后延迟执行
          setTimeout(async () => {
            try {
              const deviceKey = await getDeviceKey(sessionKey);
              setAesKey(deviceKey);
              globalAesKey = deviceKey;
              console.log('MFA: 设备主密钥恢复成功，全局密钥已设置');
            } catch (err) {
              console.error('MFA: 设备主密钥恢复失败:', err);
              setAesKey(null);
              globalAesKey = null;
            }
          }, 10);
        } else {
          console.warn('MFA: 未收到 sessionKey');
          setAesKey(null);
          globalAesKey = null;
        }
      }, 10);
    };

    window.addEventListener('mfaVerified', handleMfaVerified);
    return () => {
      window.removeEventListener('mfaVerified', handleMfaVerified);
    };
  }, []);

  // 用于记录已处理的签名请求，防止重复处理
  const processedRequestIds = useRef(new Set());
  
  // 创建稳定的 handler 引用
  const signRequestHandler = useRef(null);

  useEffect(() => {
    // 定义 handler
    const handler = async (e) => {
      const { data, requestId } = e.detail;

      // 避免重复处理同一请求（React StrictMode 导致的双重执行）
      if (processedRequestIds.current.has(requestId)) {
        console.log('[App] 忽略重复的签名请求，requestId:', requestId);
        return;
      }
      processedRequestIds.current.add(requestId);

      console.log('[App] 收到签名请求，requestId:', requestId);
      let signature = null;

      try {
        const currentAesKey = globalAesKey;
        console.log('[App] currentAesKey:', currentAesKey ? '存在' : 'null');

        if (!currentAesKey) {
          console.warn('[App] 设备主密钥未设置，无法签名');
        } else {
          // 只读取密钥对，不自动生成！
          const keyPair = await getSM2KeyPairWithAesKey(currentAesKey);
          console.log('[App] 获取 keyPair:', keyPair ? '成功' : 'null');

          if (keyPair?.privateKey) {
            signature = signWithSM2(data, keyPair.privateKey);
            keyPair.privateKey = null; // 用后即焚
            console.log('[App] 签名成功，signature:', signature ? signature.substring(0, 20) + '...' : 'null');
          } else {
            console.error('[App] SM2密钥对缺失，请重新登录');
          }
        }
      } catch (err) {
        console.error('[App] 签名失败:', err);
      }

      // 清理已处理的 requestId（10秒后移除）
      setTimeout(() => {
        processedRequestIds.current.delete(requestId);
      }, 10000);

      window.dispatchEvent(new CustomEvent(SIGN_RESPONSE_EVENT, {
        detail: { requestId, signature }
      }));
    };

    signRequestHandler.current = handler;

    // 保证只有一个监听器
    window.removeEventListener(SIGN_REQUEST_EVENT, signRequestHandler.current);
    window.addEventListener(SIGN_REQUEST_EVENT, signRequestHandler.current);

    return () => {
      window.removeEventListener(SIGN_REQUEST_EVENT, signRequestHandler.current);
    };
  }, []); // 空依赖数组，仅在挂载时执行

  const login = async (username, password) => {
    try {
      console.log('Attempting login for user:', username);
      localStorage.removeItem('token'); // 清除旧 token，避免过期 token 导致登录请求被安全链拦截
      const response = await post('/api/v1/auth/login', { username, password }, true);

      const data = await response.json();
      console.log('Login response:', { success: data.success });

      if (data.success) {
        if (data.requireMfa) {
          localStorage.setItem('tempToken', data.tempToken);
          return { requireMfa: true };
        }

        setUser(data.user);
        localStorage.setItem('user', JSON.stringify(data.user));
        localStorage.setItem('token', data.token);

        // 解构登录核心数据
        const token = data.token;
        const userId = data.user.id;
        const sessionKey = data.sessionKey;

        // 获取或生成设备主密钥
        try {
          // 用 sessionKey 恢复或生成设备主密钥
          const deviceKey = await getDeviceKey(sessionKey);

          // 检查是否有注册时待迁移的密钥对
          const pendingKeyPairStr = sessionStorage.getItem('pendingKeyPair');
          if (pendingKeyPairStr) {
            try {
              const pendingData = JSON.parse(pendingKeyPairStr);

              // 用临时密钥解密私钥
              const tempKeyRaw = new Uint8Array(atob(pendingData.tempKey).split('').map(c => c.charCodeAt(0)));
              const tempKey = await crypto.subtle.importKey(
                'raw', tempKeyRaw, { name: 'AES-GCM', length: 256 },
                false, ['decrypt']
              );
              const privateKey = await decryptPrivateKey(pendingData.encryptedPrivateKey, tempKey);

              // 用设备主密钥重新加密并存入 localStorage
              const deviceEncrypted = await encryptPrivateKey(privateKey, deviceKey);
              localStorage.setItem('sm2_private_key_encrypted', deviceEncrypted.ciphertext);
              localStorage.setItem('sm2_private_key_iv', deviceEncrypted.iv);
              localStorage.setItem('sm2_public_key', pendingData.publicKey);

              // 清除 sessionStorage
              sessionStorage.removeItem('pendingKeyPair');

              console.log('Login: 注册时暂存的密钥对已迁移到设备主密钥加密');
            } catch (err) {
              console.error('Login: 迁移注册时暂存的密钥对失败:', err);
            }
          }

          // 获取 SM2 密钥对
          let keyPair = await getSM2KeyPair(deviceKey);

          // 如果新设备主密钥无法解密私钥，尝试旧密码方式迁移
          if (!keyPair) {
            const oldSalt = localStorage.getItem('sm2_salt');
            const oldEncryptedCiphertext = localStorage.getItem('sm2_private_key_encrypted');
            const oldIv = localStorage.getItem('sm2_private_key_iv');

            if (oldSalt && oldEncryptedCiphertext && oldIv) {
              // 用密码派生密钥解密私钥
              const passwordAesKey = await deriveKey(password, oldSalt);
              const oldPrivateKey = await decryptPrivateKey(
                { ciphertext: oldEncryptedCiphertext, iv: oldIv },
                passwordAesKey
              );

              // 用设备主密钥重新加密私钥
              await saveSM2KeyPair({
                publicKey: localStorage.getItem('sm2_public_key'),
                privateKey: oldPrivateKey
              }, deviceKey);

              // 删除旧盐值
              localStorage.removeItem('sm2_salt');
              console.log('旧私钥已迁移到设备主密钥加密');

              // 重新获取密钥对
              keyPair = await getSM2KeyPair(deviceKey);
            }
          }

          // 将设备主密钥存入 Context 和全局变量（必须在 put() 之前，否则签名无法工作）
          setAesKey(deviceKey);
          globalAesKey = deviceKey;

          // 如果密钥对仍不存在，生成新的
          if (!keyPair) {
            const { generateSM2KeyPair } = await import('./utils/cryptoUtils');
            keyPair = generateSM2KeyPair();
            await saveSM2KeyPair(keyPair, deviceKey);

            // 更新后端公钥
            await put(`/api/v1/users/${userId}/update-sm2-key`, { sm2PublicKey: keyPair.publicKey });
            console.log('SM2密钥对生成并保存');
          }
          console.log('Login: 全局设备主密钥已设置');
          console.log('Login: 设备主密钥恢复/生成成功');
        } catch (err) {
          console.error('设备主密钥恢复/生成失败:', err);
        }

        // 获取用户完整信息
        try {
          const userResponse = await get(`/api/v1/users/${userId}`);

          const userData = await userResponse.json();

          if (userData.success) {

            // 缓存用户数据
            UserDataCache.setUserData(userData.user);
          } else {
            console.error('获取用户信息失败:', userData.message);
          }
        } catch (err) {
          console.error('获取用户信息失败:', err);
        }

        setError('');
        // 登录成功后立即预加载ZKP WASM，消除用户首次生成证明时的冷启动延迟
        preloadZkWorker();
        return true;
      } else {
        setError(data.message || '登录失败');
        return false;
      }
    } catch (err) {
      console.error('Login error:', err);
      setError('登录失败，请检查网络连接');
      return false;
    }
  };

  // 添加密码操作日志
  const addCryptoLog = (logData) => {
    const newLog = {
      id: Date.now() + Math.random().toString(36).substr(2, 9),
      userId: user?.id || 'unknown',
      timestamp: new Date().toLocaleString('zh-CN'),
      fullTimestamp: new Date().toISOString(),
      ...logData
    };

    setCryptoLogs(prevLogs => {
      const updatedLogs = [newLog, ...prevLogs];
      // 最多保留50条日志
      return updatedLogs.slice(0, 50);
    });

    syncLogToBackend(newLog);
  };

  const logout = async () => {
    // 先调用登出 API（需要 token 还在 localStorage 中）
    const token = localStorage.getItem('token');
    if (token) {
      try {
        await post('/api/v1/auth/logout', {}, true);
      } catch (err) {
        console.warn('[Logout] Failed to call logout API:', err.message);
      }
    }

    // 再清理本地状态
    setUser(null);
    setAesKey(null);
    globalAesKey = null;
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    setCryptoLogs([]);
    UserDataCache.clearUserData();
    localStorage.removeItem('sm2KeyPair');
    localStorage.removeItem('sm2_public_key');
    localStorage.removeItem('sm2_private_key_encrypted');
    localStorage.removeItem('sm2_private_key_iv');
    localStorage.removeItem('sm2_salt');
    localStorage.removeItem('deviceKeyEncrypted');
    sessionStorage.removeItem('pendingKeyPair');
    terminateZkWorker();
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AesKeyContext.Provider value={aesKey}>
        <Router>
          <Navbar user={user} onLogout={logout} onToggleLogPanel={() => setLogPanelVisible(!logPanelVisible)} />
          {isLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
              加载中...
            </Box>
          ) : (
          <Routes>
            <Route path="/" element={
              user ? <Navigate to="/profile" /> : <Home onLogin={login} error={error} cryptoLogs={cryptoLogs} setCryptoLogs={setCryptoLogs} />
            } />
            {/* 保护所有需要登录的路由 */}
            <Route path="/profile" element={
              user ? <ErrorBoundary><Profile user={user} cryptoLogs={cryptoLogs} setCryptoLogs={setCryptoLogs} /></ErrorBoundary> : <Navigate to="/" />
            } />
            <Route path="/credit-proof" element={
              user ? <ErrorBoundary><CreditProof user={user} cryptoLogs={cryptoLogs} setCryptoLogs={setCryptoLogs} /></ErrorBoundary> : <Navigate to="/" />
            } />
            <Route path="/account" element={
              user ? <ErrorBoundary><Account user={user} cryptoLogs={cryptoLogs} setCryptoLogs={setCryptoLogs} /></ErrorBoundary> : <Navigate to="/" />
            } />
            <Route path="/borrow" element={
              user ? <ErrorBoundary><Borrow user={user} cryptoLogs={cryptoLogs} setCryptoLogs={setCryptoLogs} /></ErrorBoundary> : <Navigate to="/" />
            } />
            <Route path="/invest" element={
              user ? <ErrorBoundary><InvestPage user={user} cryptoLogs={cryptoLogs} setCryptoLogs={setCryptoLogs} /></ErrorBoundary> : <Navigate to="/" />
            } />
            <Route path="/redeem" element={
              user ? <ErrorBoundary><RedeemPage user={user} cryptoLogs={cryptoLogs} setCryptoLogs={setCryptoLogs} /></ErrorBoundary> : <Navigate to="/" />
            } />
            <Route path="/fund-pool" element={
              user ? <ErrorBoundary><FundPoolPage user={user} cryptoLogs={cryptoLogs} setCryptoLogs={setCryptoLogs} /></ErrorBoundary> : <Navigate to="/" />
            } />
            <Route path="/my-invest" element={
              user ? <ErrorBoundary><MyInvestPage user={user} cryptoLogs={cryptoLogs} setCryptoLogs={setCryptoLogs} /></ErrorBoundary> : <Navigate to="/" />
            } />
            <Route path="/mfa/setup" element={
              user ? <ErrorBoundary><MfaSetup user={user} /></ErrorBoundary> : <Navigate to="/" />
            } />
            <Route path="/mfa/verify" element={
              user ? <Navigate to="/profile" replace /> : <MfaVerify />
            } />
            <Route path="/blockchain" element={
              user ? <ErrorBoundary><BlockchainExplorer /></ErrorBoundary> : <Navigate to="/" />
            } />
            {/* 未匹配的路由重定向到登录页 */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          )}
          <CryptoLogPanel 
            logs={cryptoLogs} 
            isVisible={logPanelVisible} 
            onToggle={() => setLogPanelVisible(!logPanelVisible)} 
            user={user} 
          />
        </Router>
      </AesKeyContext.Provider>
    </ThemeProvider>
  );
}

export default App; 
