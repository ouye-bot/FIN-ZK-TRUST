import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Container,
  Typography,
  Button,
  Grid,
  Card,
  CardContent,
  Box,
  TextField,
  Paper,
  Alert,
  Tabs,
  Tab,
  LinearProgress,
  Chip,
  Fade,
  Divider,
  IconButton,
} from '@mui/material';
import SecurityIcon from '@mui/icons-material/Security';
import ShieldIcon from '@mui/icons-material/Shield';
import LockIcon from '@mui/icons-material/Lock';
import VerifiedIcon from '@mui/icons-material/Verified';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ArrowRightIcon from '@mui/icons-material/ArrowRight';
import { generateSM2KeyPair } from '../utils/cryptoUtils';
import { encryptPrivateKey } from '../utils/secureKeyStore';
import { post } from '../utils/apiUtils';
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar } from 'recharts';

function Home({ user, onLogin, error, cryptoLogs, setCryptoLogs }) {
  const addCryptoLog = (operationType, description, status, detail = '', correlationInfo = null) => {
    if (!setCryptoLogs) return;
    const now = new Date();
    const formattedTime = now.toLocaleTimeString('zh-CN', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    const logId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    const log = {
      id: logId,
      userId: user?.id || user?.username || 'anonymous',
      operationType,
      description,
      status,
      detail,
      timestamp: formattedTime,
      fullTimestamp: now.toISOString(),
      correlationInfo
    };
    setCryptoLogs(prevLogs => {
      const newLogs = [...prevLogs, log];
      if (newLogs.length > 50) {
        return newLogs.slice(-50);
      }
      return newLogs;
    });
  };
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState(0);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [registerError, setRegisterError] = useState('');
  const [registerSuccess, setRegisterSuccess] = useState('');
  const [passwordStrength, setPasswordStrength] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [registerLoading, setRegisterLoading] = useState(false);
  const [registerProgress, setRegisterProgress] = useState('');

  // 系统安全架构数据
  const securityData = [
    { name: '零知识证明技术', value: 40, color: '#3b82f6' },
    { name: '国密算法SM2,SM3', value: 35, color: '#10b981' },
    { name: '区块链与智能合约', value: 25, color: '#6366f1' },
  ];

  // 性能对比数据
  const performanceData = [
    { name: '传统金融', time: 100, efficiency: 40 },
    { name: '国密ZKP隐私金融', time: 5, efficiency: 95 },
  ];

  // 系统特性雷达图数据
  const radarData = [
    { subject: '安全性', A: 95, fullMark: 100 },
    { subject: '隐私保护', A: 98, fullMark: 100 },
    { subject: '效率', A: 90, fullMark: 100 },
    { subject: '可靠性', A: 92, fullMark: 100 },
    { subject: '透明度', A: 85, fullMark: 100 },
    { subject: '可扩展性', A: 88, fullMark: 100 },
  ];

  const features = [
    {
      icon: <SecurityIcon sx={{ fontSize: 40, color: '#3b82f6' }} />,
      title: '零知识证明技术',
      description: '使用零知识证明（ZK-SNARKs）技术，在不泄露敏感财务数据的情况下证明信用状况，实现隐私保护下的信用验证。',
      color: '#3b82f6',
    },
    {
      icon: <LockIcon sx={{ fontSize: 40, color: '#10b981' }} />,
      title: '国密算法SM2,SM3',
      description: '采用国家密码局认证的SM2椭圆曲线密码算法和SM3哈希算法，提供高安全性的数字签名和数据加密保护。',
      color: '#10b981',
    },
    {
      icon: <VerifiedIcon sx={{ fontSize: 40, color: '#6366f1' }} />,
      title: '区块链与智能合约技术',
      description: '基于区块链技术和智能合约，实现去中心化的身份管理、交易执行和信用验证，确保系统的透明性和安全性。',
      color: '#6366f1',
    },
  ];

  const techFeatures = [
    { icon: <ShieldIcon />, label: '零知识证明', desc: '保护隐私', color: '#3b82f6' },
    { icon: <LockIcon />, label: 'SM2国密', desc: '安全加密', color: '#10b981' },
    { icon: <VerifiedIcon />, label: '区块链', desc: '去中心化', color: '#6366f1' },
  ];

  const handleLogin = async (e) => {
    e.preventDefault();
    addCryptoLog('密码验证', '用户登录验证', '发起', `用户名: ${username}`);
    try {
      const result = await onLogin(username, password);
      if (result === true) {
        addCryptoLog('密码验证', '用户登录验证', '成功', `登录成功: ${username}`);
        navigate('/profile');
      } else if (result?.requireMfa) {
        addCryptoLog('密码验证', '用户登录验证', '成功', `MFA验证待完成: ${username}`);
        navigate('/mfa/verify');
      } else {
        addCryptoLog('密码验证', '用户登录验证', '失败', `登录失败: ${username}`);
      }
    } catch (err) {
      addCryptoLog('密码验证', '用户登录验证', '失败', `登录异常: ${err.message}`);
    }
  };

  // 密码强度检测
  const checkPasswordStrength = (pass) => {
    if (!pass) {
      setPasswordStrength('');
      setPasswordError('');
      return;
    }

    let strength = 0;
    let errors = [];

    if (pass.length < 8) {
      errors.push('密码长度至少8位');
    } else {
      strength += 1;
    }

    if (/[A-Z]/.test(pass)) {
      strength += 1;
    } else {
      errors.push('必须包含至少一个大写字母');
    }

    if (/[a-z]/.test(pass)) {
      strength += 1;
    } else {
      errors.push('必须包含至少一个小写字母');
    }

    let strengthText = '';
    if (strength < 2) strengthText = '弱';
    else if (strength < 3) strengthText = '中';
    else strengthText = '强';

    setPasswordStrength(strengthText);
    setPasswordError(errors.length > 0 ? errors.join('; ') : '');
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setRegisterLoading(true);
    setRegisterProgress('正在生成密钥...');
    addCryptoLog('密码操作', '用户注册', '发起', `用户名: ${username}`);
    try {
      setRegisterError('');
      setRegisterSuccess('');

      // 验证密码
      if (password !== confirmPassword) {
        addCryptoLog('密码操作', '用户注册', '失败', '两次输入的密码不一致');
        setRegisterError('两次输入的密码不一致');
        setRegisterLoading(false);
        setRegisterProgress('');
        return;
      }

      if (passwordError) {
        addCryptoLog('密码操作', '用户注册', '失败', passwordError);
        setRegisterError(passwordError);
        setRegisterLoading(false);
        setRegisterProgress('');
        return;
      }

      // 生成SM2密钥对
      console.time('generateSM2KeyPair');
      setRegisterProgress('正在生成SM2密钥对...');
      const keyPair = generateSM2KeyPair();
      const publicKey = keyPair.publicKey;
      console.timeEnd('generateSM2KeyPair');
      console.log('Generated SM2 public key:', publicKey);
      console.log('Public key length:', publicKey.length);

      // 生成随机临时密钥（16 字节 Base64）
      const tempKey = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );
      const rawTempKey = await crypto.subtle.exportKey('raw', tempKey);
      const tempKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(rawTempKey)));

      // 用临时密钥加密私钥
      setRegisterProgress('正在加密私钥...');
      const encryptedPrivateKey = await encryptPrivateKey(keyPair.privateKey, tempKey);

      // 存入 sessionStorage
      sessionStorage.setItem('pendingKeyPair', JSON.stringify({
        publicKey: publicKey,
        encryptedPrivateKey: encryptedPrivateKey,
        tempKey: tempKeyBase64
      }));

      setRegisterProgress('正在注册账户...');
      const response = await post('/api/v1/auth/register', {
        username,
        password,
        sm2PublicKey: publicKey
      }, true);

      const data = await response.json();

      if (data.success) {
        addCryptoLog('密码操作', '用户注册', '成功', `注册成功: ${username}`);
        setRegisterSuccess('注册成功，请登录');
        // 切换到登录选项卡
        setActiveTab(0);
      } else {
        addCryptoLog('密码操作', '用户注册', '失败', data.message || '注册失败');
        setRegisterError(data.message || '注册失败');
        // 清除临时存储的密钥对
        sessionStorage.removeItem('pendingKeyPair');
      }
    } catch (err) {
      addCryptoLog('密码操作', '用户注册', '失败', `注册异常: ${err.message}`);
      console.error('注册错误:', err);
      setRegisterError('注册失败，请检查网络连接');
    } finally {
      setRegisterLoading(false);
      setRegisterProgress('');
    }
  };

  if (user) {
    return (
      <Container maxWidth="lg">
        <Box sx={{ mt: 4, textAlign: 'center' }}>
          <Typography variant="h4" component="h1" gutterBottom>
            欢迎回来, {user.username}!
          </Typography>
          <Grid container spacing={3} sx={{ mt: 3 }}>
            <Grid item xs={12} md={4}>
              <Paper sx={{ p: 3, height: '100%' }}>
                <Typography variant="h6" gutterBottom>
                  账户信息
                </Typography>
                <Typography>余额: {user.balance}</Typography>
                <Typography>信用分数: {user.creditScore}</Typography>
                <Typography>钱包地址: {user.walletAddress}</Typography>
              </Paper>
            </Grid>
            <Grid item xs={12} md={4}>
              <Paper sx={{ p: 3, height: '100%' }}>
                <Typography variant="h6" gutterBottom>
                  系统安全架构
                </Typography>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={securityData}
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {securityData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </Paper>
            </Grid>
            <Grid item xs={12} md={4}>
              <Paper sx={{ p: 3, height: '100%' }}>
                <Typography variant="h6" gutterBottom>
                  性能对比
                </Typography>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={performanceData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="efficiency" fill="#00B4D8" name="效率指数" />
                  </BarChart>
                </ResponsiveContainer>
              </Paper>
            </Grid>
          </Grid>
        </Box>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg">
      <Grid container spacing={6} sx={{ mt: 8, mb: 8 }}>
        {/* 左侧：登录/注册表单 */}
        <Grid item xs={12} md={5}>
          <Fade in={true} timeout={1000}>
            <Paper sx={{ p: 6, height: '100%', display: 'flex', flexDirection: 'column' }}>
              <Box sx={{ mb: 6, textAlign: 'center' }}>
                <Typography variant="h3" component="h1" gutterBottom sx={{ fontWeight: 700 }}>
                  基于国密ZKP的隐私金融信贷系统
                </Typography>
                <Typography variant="subtitle1" color="text.secondary" sx={{ maxWidth: 300, mx: 'auto' }}>
                  基于国密算法和零知识证明的隐私保护金融信贷平台
                </Typography>
              </Box>

              <Tabs
                value={activeTab}
                onChange={(e, newValue) => setActiveTab(newValue)}
                centered
                sx={{ mb: 4 }}
                TabIndicatorProps={{
                  style: {
                    backgroundColor: '#3b82f6',
                  },
                }}
              >
                <Tab label="登录" sx={{ fontWeight: 500 }} />
                <Tab label="注册" sx={{ fontWeight: 500 }} />
              </Tabs>

              {activeTab === 0 && (
                <form onSubmit={handleLogin} sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <Typography variant="h6" gutterBottom sx={{ mb: 3, fontWeight: 600 }}>
                    登录账户
                  </Typography>
                  {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}
                  <TextField
                    fullWidth
                    label="用户名"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    margin="normal"
                    required
                    sx={{ mb: 2 }}
                    InputProps={{
                      sx: {
                        borderRadius: 2,
                      },
                    }}
                  />
                  <TextField
                    fullWidth
                    label="密码"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    margin="normal"
                    required
                    sx={{ mb: 4 }}
                    InputProps={{
                      sx: {
                        borderRadius: 2,
                      },
                    }}
                  />
                  <Button
                    type="submit"
                    fullWidth
                    variant="contained"
                    sx={{
                      mt: 'auto',
                      py: 1.5,
                      background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                      '&:hover': {
                        background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                      },
                    }}
                  >
                    登录
                  </Button>
                </form>
              )}

              {activeTab === 1 && (
                <form onSubmit={handleRegister} sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <Typography variant="h6" gutterBottom sx={{ mb: 3, fontWeight: 600 }}>
                    注册新账户
                  </Typography>
                  {registerError && <Alert severity="error" sx={{ mb: 3 }}>{registerError}</Alert>}
                  {registerSuccess && <Alert severity="success" sx={{ mb: 3 }}>{registerSuccess}</Alert>}
                  <TextField
                    fullWidth
                    label="用户名"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    margin="normal"
                    required
                    disabled={registerLoading}
                    sx={{ mb: 2 }}
                    InputProps={{
                      sx: {
                        borderRadius: 2,
                      },
                    }}
                  />
                  <TextField
                    fullWidth
                    label="密码"
                    type="password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      checkPasswordStrength(e.target.value);
                    }}
                    margin="normal"
                    required
                    disabled={registerLoading}
                    sx={{ mb: 2 }}
                    InputProps={{
                      sx: {
                        borderRadius: 2,
                      },
                    }}
                  />
                  {password && (
                    <Box sx={{ mb: 3 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                        <Typography variant="body2" color="text.secondary">
                          密码强度
                        </Typography>
                        <Chip
                          label={passwordStrength}
                          size="small"
                          color={passwordStrength === '强' ? 'success' : passwordStrength === '中' ? 'warning' : 'error'}
                          sx={{
                            backgroundColor: passwordStrength === '强' ? '#10b981' : passwordStrength === '中' ? '#f59e0b' : '#ef4444',
                            color: 'white',
                          }}
                        />
                      </Box>
                      <LinearProgress
                        variant="determinate"
                        value={passwordStrength === '强' ? 100 : passwordStrength === '中' ? 60 : 30}
                        sx={{
                          height: 8,
                          borderRadius: 4,
                          backgroundColor: '#e2e8f0',
                          '& .MuiLinearProgress-bar': {
                            backgroundColor: passwordStrength === '强' ? '#10b981' : passwordStrength === '中' ? '#f59e0b' : '#ef4444',
                          },
                        }}
                      />
                    </Box>
                  )}
                  {passwordError && (
                    <Alert severity="error" sx={{ mb: 3 }}>{passwordError}</Alert>
                  )}
                  <TextField
                    fullWidth
                    label="确认密码"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    margin="normal"
                    required
                    disabled={registerLoading}
                    sx={{ mb: 4 }}
                    InputProps={{
                      sx: {
                        borderRadius: 2,
                      },
                    }}
                  />
                  {registerLoading && (
                    <Box sx={{ mb: 2 }}>
                      <LinearProgress sx={{ mb: 1 }} />
                      <Typography variant="body2" color="text.secondary" align="center">
                        {registerProgress}
                      </Typography>
                    </Box>
                  )}
                  <Button
                    type="submit"
                    fullWidth
                    variant="contained"
                    disabled={registerLoading}
                    sx={{
                      mt: 'auto',
                      py: 1.5,
                      background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                      '&:hover': {
                        background: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
                      },
                    }}
                  >
                    {registerLoading ? '注册中...' : '注册'}
                  </Button>
                </form>
              )}
            </Paper>
          </Fade>
        </Grid>

        {/* 右侧：系统特性展示 */}
        <Grid item xs={12} md={7}>
          <Fade in={true} timeout={1500}>
            <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
              <Typography variant="h4" gutterBottom sx={{ mb: 6, fontWeight: 600 }}>
                系统特性
              </Typography>

              {/* 特性卡片 */}
              <Grid container spacing={3} sx={{ mb: 6 }}>
                {features.map((feature, index) => (
                  <Grid item xs={12} key={index}>
                    <Card
                      sx={{
                        p: 4,
                        transition: 'all 0.3s ease',
                        '&:hover': {
                          transform: 'translateY(-4px)',
                          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
                        }
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 3 }}>
                        <Box sx={{
                          p: 2,
                          borderRadius: 2,
                          backgroundColor: `${feature.color}10`,
                          color: feature.color,
                        }}>
                          {feature.icon}
                        </Box>
                        <Box flex={1}>
                          <Typography variant="h6" sx={{ mb: 1, fontWeight: 600 }}>
                            {feature.title}
                          </Typography>
                          <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>
                            {feature.description}
                          </Typography>
                          <Button
                            variant="text"
                            endIcon={<ChevronRightIcon />}
                            sx={{
                              mt: 2,
                              color: feature.color,
                              p: 0,
                              '&:hover': {
                                backgroundColor: 'transparent',
                                textDecoration: 'underline',
                              }
                            }}
                          >
                            了解更多
                          </Button>
                        </Box>
                      </Box>
                    </Card>
                  </Grid>
                ))}
              </Grid>

              {/* 技术特点 */}
              <Typography variant="h5" gutterBottom sx={{ mb: 4, fontWeight: 600 }}>
                核心技术
              </Typography>
              <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', mb: 6 }}>
                {techFeatures.map((tech, index) => (
                  <Card key={index} sx={{
                    flex: 1,
                    minWidth: 180,
                    p: 3,
                    textAlign: 'center',
                    border: `1px solid ${tech.color}20`,
                    '&:hover': {
                      borderColor: tech.color,
                      boxShadow: `0 0 0 3px ${tech.color}10`,
                    }
                  }}>
                    <Box sx={{
                      p: 2,
                      mx: 'auto',
                      mb: 2,
                      borderRadius: '50%',
                      width: 60,
                      height: 60,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: `${tech.color}10`,
                      color: tech.color,
                    }}>
                      {tech.icon}
                    </Box>
                    <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>
                      {tech.label}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {tech.desc}
                    </Typography>
                  </Card>
                ))}
              </Box>

              {/* 数据可视化部分 */}
              <Grid container spacing={3}>
                {/* 安全架构分布 */}
                <Grid item xs={12} md={6}>
                  <Card sx={{ p: 3, height: '100%' }}>
                    <Typography variant="h6" gutterBottom sx={{ mb: 3, fontWeight: 600 }}>
                      安全架构分布
                    </Typography>
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie
                          data={securityData}
                          cx="50%"
                          cy="50%"
                          innerRadius={40}
                          outerRadius={80}
                          paddingAngle={5}
                          dataKey="value"
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                          labelLine={false}
                        >
                          {securityData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </Card>
                </Grid>

                {/* 系统特性雷达图 */}
                <Grid item xs={12} md={6}>
                  <Card sx={{ p: 3, height: '100%' }}>
                    <Typography variant="h6" gutterBottom sx={{ mb: 3, fontWeight: 600 }}>
                      系统性能评估
                    </Typography>
                    <ResponsiveContainer width="100%" height={200}>
                      <RadarChart cx="50%" cy="50%" outerRadius={80} data={radarData}>
                        <PolarGrid stroke="#e2e8f0" />
                        <PolarAngleAxis dataKey="subject" tick={{ fill: '#64748b', fontSize: 10 }} />
                        <PolarRadiusAxis angle={30} domain={[0, 100]} />
                        <Radar name="国密ZKP隐私金融" dataKey="A" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.3} />
                        <Tooltip />
                      </RadarChart>
                    </ResponsiveContainer>
                  </Card>
                </Grid>
              </Grid>
            </Box>
          </Fade>
        </Grid>
      </Grid>
    </Container>
  );
}

export default Home;
