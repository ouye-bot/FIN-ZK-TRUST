import React, { useState, useEffect } from 'react';
import {
  Container,
  Typography,
  Box,
  Paper,
  Tabs,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Button,
  Alert,
  Card,
  CardContent,
  Grid,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { ethers } from 'ethers';
import { signWithSM2, getSM2KeyPair, generateSM2KeyPair, saveSM2KeyPair, generateSignatureData } from '../utils/sm2Utils';
import { get, post } from '../utils/apiUtils';

function TabPanel(props) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`profile-tabpanel-${index}`}
      aria-labelledby={`profile-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
}

const Profile = ({ user }) => {
  const [account, setAccount] = useState('');
  const [activeTab, setActiveTab] = useState(0);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [creditHistory, setCreditHistory] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userData, setUserData] = useState(null);
  const [latestProof, setLatestProof] = useState(null);
  const [repayDialogOpen, setRepayDialogOpen] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const [systemBalance, setSystemBalance] = useState(0);
  const [isAdmin, setIsAdmin] = useState(false);
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [mfaLoading, setMfaLoading] = useState(false);
  const navigate = useNavigate();

  const fetchUserData = async () => {
    try {
      setLoading(true);
      // 获取用户信息
      const userResponse = await get(`/api/v1/users/${user.id}`);
      const userData = await userResponse.json();

      if (userData.success && userData.user) {
        setUserData(userData.user);
        setIsAdmin(userData.user.role === 'admin');
      } else {
        setUserData(null);
        setIsAdmin(false);
      }

      // 获取信用历史
      const creditResponse = await get(`/api/v1/credit/${user.id}`);
      const creditData = await creditResponse.json();

      if (creditData.success && creditData.creditHistory) {
        setCreditHistory(creditData.creditHistory);
      } else {
        setCreditHistory([]);
      }

      // 获取交易历史
      const transactionsResponse = await get(`/api/v1/loan/transactions/${user.id}`);
      const transactionsData = await transactionsResponse.json();

      if (transactionsData.success && transactionsData.transactions) {
        setTransactions(transactionsData.transactions);
      } else {
        setTransactions([]);
      }

      // 获取最新信用证明
      const proofResponse = await get(`/api/v1/credit/${user.id}`);
      const proofData = await proofResponse.json();

      if (proofData.success && proofData.proof) {
        setLatestProof(proofData.proof);
      } else {
        setLatestProof(null);
      }

      // 暂时注释掉系统余额获取，因为后端还没有实现这个接口
      /*
      // 如果是管理员，获取系统余额
      if (userData.user.role === 'admin') {
        const balanceResponse = await get('/api/v1/system-balance');
        const balanceData = await balanceResponse.json();
        if (balanceData.success) {
          setSystemBalance(balanceData.balance);
        }
      }
      */

      setLoading(false);
    } catch (err) {
      console.error('获取用户数据失败:', err);
      setError('获取用户数据失败');
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      fetchUserData();
      fetchMfaStatus();
    }
  }, [user]);

  const fetchMfaStatus = async () => {
    try {
      setMfaLoading(true);
      const token = localStorage.getItem('token');
      const response = await fetch('/api/v1/mfa/status', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await response.json();
      if (data.success) {
        setMfaEnabled(data.enabled);
      }
    } catch (err) {
      console.error('获取 MFA 状态失败:', err);
    } finally {
      setMfaLoading(false);
    }
  };

  // 监听数据更新事件
  useEffect(() => {
    const handleDataUpdated = () => {
      console.log('Data updated event received, refreshing user data...');
      fetchUserData();
    };

    // 监听借款、出资、还款等操作完成的事件
    window.addEventListener('refreshUserData', handleDataUpdated);
    window.addEventListener('refreshPoolData', handleDataUpdated);
    window.addEventListener('refreshRedeemData', handleDataUpdated);

    return () => {
      window.removeEventListener('refreshUserData', handleDataUpdated);
      window.removeEventListener('refreshPoolData', handleDataUpdated);
      window.removeEventListener('refreshRedeemData', handleDataUpdated);
    };
  }, []);

  const handleConnectWallet = async () => {
    try {
      if (window.ethereum) {
        const provider = new ethers.BrowserProvider(window.ethereum);
        await provider.send('eth_requestAccounts', []);
        const signer = await provider.getSigner();
        const address = await signer.getAddress();
        setAccount(address);
        // TODO: Load user data
      } else {
        setError('Please install MetaMask to use this feature');
      }
    } catch (err) {
      setError('Failed to connect wallet: ' + err.message);
    }
  };

  const handleTabChange = (event, newValue) => {
    setActiveTab(newValue);
  };

  const handleRepay = (transaction) => {
    setSelectedTransaction(transaction);
    setRepayDialogOpen(true);
  };

  const handleConfirmRepay = async () => {
    try {
      // 检查是否有SM2密钥对，如果没有则生成
      let keyPair = getSM2KeyPair();
      if (!keyPair) {
        keyPair = generateSM2KeyPair();
        saveSM2KeyPair(keyPair);
      }
      
      // 准备签名数据
      const transactionData = {
        userId: user.id,
        transactionId: selectedTransaction.id
      };
      
      // 生成签名
      const signatureData = generateSignatureData(transactionData);
      const signature = signWithSM2(signatureData, keyPair.privateKey);
      
      const response = await post('/api/v1/loan/repay', {
        userId: user.id,
        transactionId: selectedTransaction.id,
        signature
      });

      const data = await response.json();

      if (data.success) {
        setSuccess(`还款成功！信用分${data.scoreChange > 0 ? '增加' : '减少'}${Math.abs(data.scoreChange)}分`);
        setRepayDialogOpen(false);
        // 刷新数据
        fetchUserData();
      } else {
        setError(data.message || '还款失败');
      }
    } catch (err) {
      setError('网络错误，请稍后重试');
    }
  };

  const handleCopyVerificationCode = () => {
    if (latestProof?.verificationCode) {
      navigator.clipboard.writeText(latestProof.verificationCode);
      setSuccess('验证码已复制到剪贴板');
    }
  };

  if (!user) {
    return (
      <Container maxWidth="md" sx={{ mt: 4 }}>
        <Alert severity="warning">请先登录</Alert>
      </Container>
    );
  }

  if (loading) {
    return (
      <Container maxWidth="md" sx={{ mt: 4, textAlign: 'center' }}>
        <CircularProgress />
      </Container>
    );
  }

  if (error) {
    return (
      <Container maxWidth="md" sx={{ mt: 4 }}>
        <Alert severity="error">{error}</Alert>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ mt: 6, mb: 8 }}>
      {success && (
        <Alert severity="success" sx={{ mb: 4, borderRadius: 2 }}>{success}</Alert>
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 4, borderRadius: 2 }}>{error}</Alert>
      )}

      <Grid container spacing={4}>
        {/* 个人信息卡片 */}
        <Grid item xs={12} md={4}>
          <Card sx={{ p: 4, height: '100%' }}>
            <Box sx={{ textAlign: 'center', mb: 4 }}>
              <Box sx={{ 
                width: 100, 
                height: 100, 
                borderRadius: '50%', 
                background: 'linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                fontSize: 40,
                fontWeight: 700,
                mx: 'auto',
                mb: 3,
              }}>
                {userData?.username?.charAt(0).toUpperCase() || 'U'}
              </Box>
              <Typography variant="h5" sx={{ fontWeight: 600, mb: 1 }}>
                {userData?.username}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                用户ID: {userData?.id}
              </Typography>
            </Box>

            <Box sx={{ borderTop: '1px solid #e2e8f0', pt: 3, spaceY: 2 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                <Typography variant="body2" color="text.secondary">
                  当前余额
                </Typography>
                <Typography variant="h6" sx={{ fontWeight: 600, color: '#10b981' }}>
                  ¥{(Number(userData?.balance) || 0).toFixed(2)}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                <Typography variant="body2" color="text.secondary">
                  信用评分
                </Typography>
                <Typography variant="h6" sx={{ fontWeight: 600, color: '#3b82f6' }}>
                  {userData?.creditScore || 0}
                </Typography>
              </Box>
              {isAdmin && (
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    系统余额
                  </Typography>
                  <Typography variant="h6" sx={{ fontWeight: 600, color: '#6366f1' }}>
                    ¥{(Number(systemBalance) || 0).toFixed(2)}
                  </Typography>
                </Box>
              )}
            </Box>

            {latestProof && (
              <Box sx={{ mt: 4, p: 3, bgcolor: '#f8fafc', borderRadius: 2, border: '1px solid #e2e8f0' }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
                  最新验证码
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', flex: 1, wordBreak: 'break-all' }}>
                    {latestProof.verificationCode}
                  </Typography>
                  <Button
                    size="small"
                    variant="contained"
                    onClick={handleCopyVerificationCode}
                    sx={{
                      background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                      '&:hover': {
                        background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                      },
                    }}
                  >
                    复制
                  </Button>
                </Box>
                <Typography variant="caption" color="text.secondary">
                  有效期至：{new Date(latestProof.expiresAt).toLocaleString()}
                </Typography>
              </Box>
            )}

            <Box sx={{ mt: 4, p: 3, bgcolor: '#f8fafc', borderRadius: 2, border: '1px solid #e2e8f0' }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
                安全设置
              </Typography>
              {mfaLoading ? (
                <Typography variant="body2" color="text.secondary">加载中...</Typography>
              ) : mfaEnabled ? (
                <Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                    <Typography variant="body2" sx={{ color: '#10b981', fontWeight: 500 }}>
                      双因子认证已启用
                    </Typography>
                  </Box>
                  <Button
                    size="small"
                    variant="outlined"
                    disabled
                    sx={{
                      borderColor: '#10b981',
                      color: '#10b981',
                      '&:hover': {
                        borderColor: '#059669',
                        backgroundColor: '#f0fdf4',
                      },
                    }}
                  >
                    已绑定
                  </Button>
                </Box>
              ) : (
                <Box>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    绑定身份验证器，提高账户安全性
                  </Typography>
                  <Button
                    size="small"
                    variant="contained"
                    onClick={() => navigate('/mfa/setup')}
                    sx={{
                      background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                      '&:hover': {
                        background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                      },
                    }}
                  >
                    绑定两步验证
                  </Button>
                </Box>
              )}
            </Box>
          </Card>
        </Grid>

        {/* 信用历史和交易记录 */}
        <Grid item xs={12} md={8}>
          <Card sx={{ p: 4, height: '100%' }}>
            <Typography variant="h5" sx={{ fontWeight: 600, mb: 4 }}>
              信用历史
            </Typography>

            {loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                <CircularProgress sx={{ color: '#3b82f6' }} />
              </Box>
            ) : (
              <Box sx={{ overflowX: 'auto' }}>
                <TableContainer sx={{ borderRadius: 2, border: '1px solid #e2e8f0' }}>
                  <Table>
                    <TableHead sx={{ bgcolor: '#f8fafc' }}>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600, borderBottom: '1px solid #e2e8f0' }}>
                          时间
                        </TableCell>
                        <TableCell sx={{ fontWeight: 600, borderBottom: '1px solid #e2e8f0' }}>
                          分数
                        </TableCell>
                        <TableCell sx={{ fontWeight: 600, borderBottom: '1px solid #e2e8f0' }}>
                          变化
                        </TableCell>
                        <TableCell sx={{ fontWeight: 600, borderBottom: '1px solid #e2e8f0' }}>
                          原因
                        </TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {creditHistory.length > 0 ? (
                        creditHistory.map((record, index) => (
                          <TableRow key={index} sx={{ '&:hover': { bgcolor: '#f8fafc' } }}>
                            <TableCell sx={{ borderBottom: '1px solid #f1f5f9' }}>
                              {new Date(record.timestamp).toLocaleString()}
                            </TableCell>
                            <TableCell sx={{ borderBottom: '1px solid #f1f5f9' }}>
                              {record.score}
                            </TableCell>
                            <TableCell sx={{ borderBottom: '1px solid #f1f5f9' }}>
                              <Typography
                                sx={{
                                  color: record.change > 0 ? '#10b981' : '#ef4444',
                                  fontWeight: 500,
                                }}
                              >
                                {record.change > 0 ? '+' : ''}{record.change}
                              </Typography>
                            </TableCell>
                            <TableCell sx={{ borderBottom: '1px solid #f1f5f9' }}>
                              {record.description}
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={4} sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
                            暂无信用历史记录
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            )}
          </Card>
        </Grid>

        {/* 交易记录 */}
        <Grid item xs={12}>
          <Card sx={{ p: 4 }}>
            <Typography variant="h5" sx={{ fontWeight: 600, mb: 4 }}>
              交易记录
            </Typography>

            <Box sx={{ overflowX: 'auto' }}>
              <TableContainer sx={{ borderRadius: 2, border: '1px solid #e2e8f0' }}>
                <Table>
                  <TableHead sx={{ bgcolor: '#f8fafc' }}>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600, borderBottom: '1px solid #e2e8f0' }}>
                        交易ID
                      </TableCell>
                      <TableCell sx={{ fontWeight: 600, borderBottom: '1px solid #e2e8f0' }}>
                        类型
                      </TableCell>
                      <TableCell sx={{ fontWeight: 600, borderBottom: '1px solid #e2e8f0' }}>
                        金额
                      </TableCell>
                      <TableCell sx={{ fontWeight: 600, borderBottom: '1px solid #e2e8f0' }}>
                        状态
                      </TableCell>
                      <TableCell sx={{ fontWeight: 600, borderBottom: '1px solid #e2e8f0' }}>
                        时间
                      </TableCell>
                      <TableCell sx={{ fontWeight: 600, borderBottom: '1px solid #e2e8f0' }}>
                        操作
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {transactions.length > 0 ? (
                      transactions.map((tx, index) => (
                        <TableRow key={index} sx={{ '&:hover': { bgcolor: '#f8fafc' } }}>
                          <TableCell sx={{ borderBottom: '1px solid #f1f5f9' }}>
                            {tx.id}
                          </TableCell>
                          <TableCell sx={{ borderBottom: '1px solid #f1f5f9' }}>
                            <Box sx={{
                              display: 'inline-block',
                              px: 2,
                              py: 0.5,
                              borderRadius: 2,
                              bgcolor: tx.type === 'loan' ? '#eff6ff' : tx.type === 'repay' ? '#d1fae5' : '#fef3c7',
                              color: tx.type === 'loan' ? '#2563eb' : tx.type === 'repay' ? '#059669' : '#d97706',
                              fontSize: 12,
                              fontWeight: 500,
                            }}>
                              {tx.type === 'loan' ? '借款' : tx.type === 'repay' ? '还款' : tx.type === 'invest' ? '出资' : '赎回'}
                            </Box>
                          </TableCell>
                          <TableCell sx={{ borderBottom: '1px solid #f1f5f9', fontWeight: 500 }}>
                            ¥{(Number(tx.amount) || 0).toFixed(2)}
                          </TableCell>
                          <TableCell sx={{ borderBottom: '1px solid #f1f5f9' }}>
                            <Box sx={{
                              display: 'inline-block',
                              px: 2,
                              py: 0.5,
                              borderRadius: 2,
                              bgcolor: tx.status === 'completed' ? '#d1fae5' : '#fef3c7',
                              color: tx.status === 'completed' ? '#059669' : '#d97706',
                              fontSize: 12,
                              fontWeight: 500,
                            }}>
                              {tx.status === 'completed' ? '已完成' : '待处理'}
                            </Box>
                          </TableCell>
                          <TableCell sx={{ borderBottom: '1px solid #f1f5f9' }}>
                            {new Date(tx.timestamp).toLocaleString()}
                          </TableCell>
                          <TableCell sx={{ borderBottom: '1px solid #f1f5f9' }}>
                            {tx.type === 'loan' && tx.status === 'pending' && (
                              <Button
                                size="small"
                                variant="contained"
                                onClick={() => handleRepay(tx)}
                                sx={{
                                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                                  '&:hover': {
                                    background: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
                                  },
                                }}
                              >
                                还款
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={6} sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
                          暂无交易记录
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          </Card>
        </Grid>
      </Grid>

      {/* 还款确认对话框 */}
      <Dialog 
        open={repayDialogOpen} 
        onClose={() => setRepayDialogOpen(false)}
        sx={{
          '& .MuiPaper-root': {
            borderRadius: 2,
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
          },
        }}
      >
        <DialogTitle sx={{ fontWeight: 600 }}>确认还款</DialogTitle>
        <DialogContent sx={{ py: 3 }}>
          <Typography variant="body1" sx={{ mb: 2 }}>
            您确定要还款 <strong>¥{(Number(selectedTransaction?.amount) || 0).toFixed(2)}</strong> 元吗？
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            当前余额：¥{(Number(userData?.balance) || 0).toFixed(2)} 元
          </Typography>
          {userData && userData.balance < (selectedTransaction?.amount || 0) && (
            <Alert severity="warning" sx={{ mb: 2, borderRadius: 2 }}>
              余额不足，请先充值
            </Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button 
            onClick={() => setRepayDialogOpen(false)}
            sx={{
              color: '#64748b',
              '&:hover': {
                backgroundColor: '#f1f5f9',
              },
            }}
          >
            取消
          </Button>
          <Button
            onClick={handleConfirmRepay}
            variant="contained"
            disabled={!userData || userData.balance < (selectedTransaction?.amount || 0)}
            sx={{
              background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
              '&:hover': {
                background: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
              },
              '&:disabled': {
                background: '#94a3b8',
                cursor: 'not-allowed',
              },
            }}
          >
            确认还款
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};

export default Profile; 