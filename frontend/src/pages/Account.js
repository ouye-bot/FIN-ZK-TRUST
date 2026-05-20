import React, { useState, useEffect, useCallback } from 'react';
import {
  Container,
  Typography,
  Paper,
  Box,
  Grid,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  CircularProgress,
  Alert,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Chip,
  Tabs,
  Tab,
} from '@mui/material';
import { signWithSM2, getSM2KeyPairWithAesKey, generateSM2KeyPair, saveSM2KeyPair, generateSignatureData } from '../utils/sm2Utils';
import { get, post } from '../utils/apiUtils';
import { useAesKey } from '../App';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  Legend
} from 'recharts';

const Account = ({ user }) => {
  const aesKey = useAesKey();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [userData, setUserData] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [collectDialogOpen, setCollectDialogOpen] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const [repayDialogOpen, setRepayDialogOpen] = useState(false);
  const [warningDialogOpen, setWarningDialogOpen] = useState(false);
  const [warningMessage, setWarningMessage] = useState('');
  const [latestProof, setLatestProof] = useState(null);
  const [verificationCode, setVerificationCode] = useState('');
  const [activeTab, setActiveTab] = useState(0);
  const [balanceHistory, setBalanceHistory] = useState([]);
  const [transactionStats, setTransactionStats] = useState({
    loanCount: 0,
    investCount: 0,
    lendCount: 0,
    totalLoan: 0,
    totalInvest: 0,
    totalLend: 0,
  });

  // 获取用户信息和交易历史
  const fetchUserData = useCallback(async () => {
    try {
      setLoading(true);
      // 获取用户信息
      const userResponse = await get(`/api/v1/users/${user.id}`);
      const userData = await userResponse.json();

      if (userData.success) {
        setUserData(userData.user);
      }

      // 获取交易历史
      const transactionsResponse = await get(`/api/v1/loan/transactions/${user.id}`);
      const transactionsData = await transactionsResponse.json();

      if (transactionsData.success) {
        setTransactions(transactionsData.transactions || []);
        // 计算统计数据
        calculateStats(transactionsData.transactions || []);
        // 生成余额历史
        generateBalanceHistory(transactionsData.transactions || [], userData.user?.balance || 0);
      }

      setLoading(false);
    } catch (err) {
      console.error('获取用户数据失败:', err);
      setError('获取用户数据失败');
      setLoading(false);
    }
  }, [user?.id]);

  // 计算交易统计
  const calculateStats = (transactions) => {
    const stats = {
      loanCount: 0,
      investCount: 0,
      lendCount: 0,
      totalLoan: 0,
      totalInvest: 0,
      totalLend: 0,
    };

    transactions.forEach(t => {
      if (t.type === 'loan') {
        stats.loanCount++;
        stats.totalLoan += Number(t.amount) || 0;
      } else if (t.type === 'invest') {
        stats.investCount++;
        stats.totalInvest += Number(t.amount) || 0;
      } else if (t.type === 'lend') {
        stats.lendCount++;
        stats.totalLend += Number(t.amount) || 0;
      }
    });

    setTransactionStats(stats);
  };

  // 生成余额历史数据
  const generateBalanceHistory = (transactions, currentBalance) => {
    const sortedTransactions = [...transactions].sort((a, b) => 
      new Date(a.timestamp) - new Date(b.timestamp)
    );

    let balance = currentBalance;
    const history = [];
    
    // 从当前余额倒推历史余额
    for (let i = sortedTransactions.length - 1; i >= 0; i--) {
      const t = sortedTransactions[i];
      history.unshift({
        date: new Date(t.timestamp).toLocaleDateString(),
        balance: balance,
        type: t.type,
        amount: Number(t.amount) || 0,
      });
      
      if (t.type === 'loan') {
        balance += Number(t.amount) || 0;
      } else if (t.type === 'repay') {
        balance -= Number(t.amount) || 0;
      } else if (t.type === 'invest') {
        balance += Number(t.amount) || 0;
      } else if (t.type === 'lend') {
        balance -= Number(t.amount) || 0;
      } else if (t.type === 'collect') {
        balance += Number(t.totalAmount || t.amount) || 0;
      }
    }

    // 添加初始余额点
    if (history.length === 0 || history[0].date !== '初始') {
      history.unshift({
        date: '初始',
        balance: balance,
        type: 'init',
        amount: 0,
      });
    }

    setBalanceHistory(history);
  };

  // 交易类型分布数据
  const transactionTypeData = [
    { name: '借款', value: transactionStats.loanCount, color: '#00B4D8' },
    { name: '出资', value: transactionStats.investCount, color: '#06D6A0' },
    { name: '出资', value: transactionStats.lendCount, color: '#7209B7' },
  ];

  // 交易金额分布数据
  const transactionAmountData = [
    { name: '借款', amount: transactionStats.totalLoan, color: '#00B4D8' },
    { name: '出资', amount: transactionStats.totalInvest, color: '#06D6A0' },
    { name: '出资', amount: transactionStats.totalLend, color: '#7209B7' },
  ];

  // 获取最新信用证明
  const fetchLatestCreditProof = useCallback(async () => {
    try {
      const response = await get(`/api/v1/credit/${user.id}`);
      const data = await response.json();
      if (data.success && data.data.proof) {
        setLatestProof(data.data.proof);
      }
    } catch (err) {
      console.error('获取信用证明失败:', err);
    }
  }, [user?.id]);

  useEffect(() => {
    if (user) {
      fetchUserData();
      fetchLatestCreditProof();
    }
    
    // 监听刷新事件
    const handleRefresh = () => {
      if (user) {
        fetchUserData();
        fetchLatestCreditProof();
      }
    };
    
    window.addEventListener('refreshPoolData', handleRefresh);
    
    // 清理事件监听器
    return () => {
      window.removeEventListener('refreshPoolData', handleRefresh);
    };
  }, [user, fetchUserData, fetchLatestCreditProof]);

  const handleCollect = async (transaction) => {
    try {
      setError('');
      setSuccess('');
      const response = await post('/api/v1/loan/collect-loan', {
        userId: user.id,
        transactionId: transaction.id
      });

      const data = await response.json();

      if (data.success) {
        setSuccess('收回贷款成功！');
        setCollectDialogOpen(false);
        // 刷新数据
        setTimeout(() => {
          fetchUserData();
        }, 500);
      } else {
        if (data.message === '贷款未到期，不能收回') {
          setWarningMessage(`贷款未到期，不能收回。\n到期时间：${new Date(data.dueDate).toLocaleString()}\n剩余天数：${data.remainingDays}天`);
          setWarningDialogOpen(true);
        } else {
          setError(data.message || '收回贷款失败');
        }
      }
    } catch (err) {
      setError('网络错误，请稍后重试');
    }
  };

  const handleConfirmCollect = async () => {
    try {
      setError('');
      setSuccess('');
      const response = await post('/api/v1/loan/collect-loan', {
        userId: user.id,
        transactionId: selectedTransaction.id
      });

      const data = await response.json();

      if (data.success) {
        setSuccess('收回贷款成功！');
        setCollectDialogOpen(false);
        // 刷新数据
        setTimeout(() => {
          fetchUserData();
        }, 500);
      } else {
        setError(data.message || '收回贷款失败');
      }
    } catch (err) {
      setError('网络错误，请稍后重试');
    }
  };

  const handleRepay = (transaction) => {
    setSelectedTransaction(transaction);
    setRepayDialogOpen(true);
  };

  const handleConfirmRepay = async () => {
    if (!verificationCode) {
      setError('请输入验证口令');
      return;
    }

    if (!latestProof) {
      setError('请先生成信用证明');
      return;
    }

    try {
      // 检查是否有SM2密钥对，如果没有则生成
      let keyPair = await getSM2KeyPairWithAesKey(aesKey);
      if (!keyPair) {
        keyPair = generateSM2KeyPair();
        await saveSM2KeyPair(keyPair, aesKey);
      }
      
      // 准备签名数据
      const repayData = {
        userId: user.id,
        transactionId: selectedTransaction.id,
        creditProofId: latestProof.id
      };
      
      // 生成签名
      const signatureData = generateSignatureData(repayData);
      const signature = signWithSM2(signatureData, keyPair.privateKey);
      
      const response = await post('/api/v1/loan/repay', {
        userId: user.id,
        transactionId: selectedTransaction.id,
        creditProof: latestProof,
        verificationCode,
        signature
      });

      const data = await response.json();

      if (data.success) {
        setSuccess(`还款成功！信用分${data.scoreChange > 0 ? '增加' : '减少'}${Math.abs(data.scoreChange)}分`);
        setRepayDialogOpen(false);
        setVerificationCode('');
        // 刷新数据
        setTimeout(() => {
          fetchUserData();
        }, 500);
      } else {
        setError(data.message || '还款失败');
      }
    } catch (err) {
      setError('网络错误，请稍后重试');
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
    <Container maxWidth="lg" sx={{ mt: 4 }}>
      <Tabs
        value={activeTab}
        onChange={(e, newValue) => setActiveTab(newValue)}
        centered
        sx={{ mb: 3 }}
      >
        <Tab label="账户概览" />
        <Tab label="交易记录" />
        <Tab label="统计分析" />
      </Tabs>

      {activeTab === 0 && (
        <Grid container spacing={3}>
          {/* 用户信息卡片 */}
          <Grid item xs={12} md={4}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Typography variant="h5" gutterBottom>
                  账户信息
                </Typography>
                <Box sx={{ mt: 2 }}>
                  <Typography variant="body1">
                    用户名：{userData?.username}
                  </Typography>
                  <Typography variant="body1" color="primary" sx={{ mt: 1, fontWeight: 'bold' }}>
                    当前余额：{(userData?.balance || 0).toFixed(2)} 元
                  </Typography>
                  <Typography variant="body1" sx={{ mt: 1 }}>
                    信用评分：
                    <Chip 
                      label={userData?.creditScore || 0} 
                      color={userData?.creditScore >= 700 ? 'success' : userData?.creditScore >= 500 ? 'warning' : 'error'}
                      size="small"
                    />
                  </Typography>
                </Box>
              </CardContent>
            </Card>
          </Grid>

          {/* 交易统计卡片 */}
          <Grid item xs={12} md={4}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Typography variant="h5" gutterBottom>
                  交易统计
                </Typography>
                <Box sx={{ mt: 2 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="body2">借款次数：</Typography>
                    <Typography variant="body2" color="primary">{transactionStats.loanCount}</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="body2">出资次数：</Typography>
                    <Typography variant="body2" color="success.main">{transactionStats.investCount}</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="body2">出资次数：</Typography>
                    <Typography variant="body2" color="secondary.main">{transactionStats.lendCount}</Typography>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>

          {/* 金额统计卡片 */}
          <Grid item xs={12} md={4}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Typography variant="h5" gutterBottom>
                  金额统计
                </Typography>
                <Box sx={{ mt: 2 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="body2">借款总额：</Typography>
                    <Typography variant="body2" color="primary">{transactionStats.totalLoan.toFixed(2)} 元</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="body2">出资总额：</Typography>
                    <Typography variant="body2" color="success.main">{transactionStats.totalInvest.toFixed(2)} 元</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="body2">出资总额：</Typography>
                    <Typography variant="body2" color="secondary.main">{transactionStats.totalLend.toFixed(2)} 元</Typography>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>

          {/* 余额变化趋势图 */}
          {balanceHistory.length > 1 && (
            <Grid item xs={12}>
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    余额变化趋势
                  </Typography>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={balanceHistory}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" />
                      <YAxis />
                      <Tooltip 
                        formatter={(value, name) => [value.toFixed(2) + ' 元', '余额']}
                        labelFormatter={(label) => `日期: ${label}`}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="balance" 
                        stroke="#00B4D8" 
                        strokeWidth={2}
                        dot={{ fill: '#00B4D8' }}
                        activeDot={{ r: 8 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </Grid>
          )}
        </Grid>
      )}

      {activeTab === 1 && (
        <Grid container spacing={3}>
          {/* 交易历史 */}
          <Grid item xs={12}>
            <Paper sx={{ p: 3 }}>
              <Typography variant="h5" gutterBottom>
                个人借款记录
              </Typography>
              {error && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  {error}
                </Alert>
              )}
              {success && (
                <Alert severity="success" sx={{ mb: 2 }}>
                  {success}
                </Alert>
              )}
              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>时间</TableCell>
                      <TableCell>金额</TableCell>
                      <TableCell>到期时间</TableCell>
                      <TableCell>状态</TableCell>
                      <TableCell>操作</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {transactions
                      .filter(t => t.type === 'loan')
                      .map((transaction) => (
                        <TableRow key={transaction.id}>
                          <TableCell>
                            {new Date(transaction.created_at || transaction.timestamp).toLocaleString()}
                          </TableCell>
                          <TableCell>{(Number(transaction.amount) || 0).toFixed(2)} 元</TableCell>
                          <TableCell>
                            {(transaction.due_date || transaction.dueDate) ? new Date(transaction.due_date || transaction.dueDate).toLocaleString() : '暂无'}
                          </TableCell>
                          <TableCell>
                            <Chip 
                              label={transaction.status === 'pending' ? '进行中' : '已完成'}
                              color={transaction.status === 'pending' ? 'warning' : 'success'}
                              size="small"
                            />
                          </TableCell>
                          <TableCell>
                            {transaction.status === 'pending' && (
                              <Button
                                variant="contained"
                                color="primary"
                                size="small"
                                onClick={() => handleRepay(transaction)}
                              >
                                还款
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    {transactions.filter(t => t.type === 'loan').length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} align="center">
                          暂无借款记录
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          </Grid>

          {/* 个人出资记录 */}
          <Grid item xs={12}>
            <Paper sx={{ p: 3 }}>
              <Typography variant="h5" gutterBottom>
                个人出资记录
              </Typography>
              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>时间</TableCell>
                      <TableCell>金额</TableCell>
                      <TableCell>出资期限</TableCell>
                      <TableCell>到期时间</TableCell>
                      <TableCell>预期收益</TableCell>
                      <TableCell>状态</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {transactions
                      .filter(t => t.type === 'invest')
                      .map((transaction) => (
                        <TableRow key={transaction.id}>
                          <TableCell>
                            {new Date(transaction.created_at || transaction.timestamp).toLocaleString()}
                          </TableCell>
                          <TableCell>{(Number(transaction.amount) || 0).toFixed(2)} 元</TableCell>
                          <TableCell>{transaction.term || 0} 天</TableCell>
                          <TableCell>
                            {transaction.maturityDate ? new Date(transaction.maturityDate).toLocaleString() : '暂无'}
                          </TableCell>
                          <TableCell>{(Number(transaction.expectedReturn) || 0).toFixed(2)} 元</TableCell>
                          <TableCell>
                            <Chip 
                              label={transaction.status === 'active' ? '进行中' : '已完成'}
                              color={transaction.status === 'active' ? 'warning' : 'success'}
                              size="small"
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    {transactions.filter(t => t.type === 'invest').length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} align="center">
                          暂无出资记录
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          </Grid>
        </Grid>
      )}

      {activeTab === 2 && (
        <Grid container spacing={3}>
          {/* 交易类型分布 */}
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  交易类型分布
                </Typography>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={transactionTypeData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={5}
                      dataKey="value"
                      label={({ name, value }) => `${name}: ${value}次`}
                    >
                      {transactionTypeData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </Grid>

          {/* 交易金额分布 */}
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  交易金额分布
                </Typography>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={transactionAmountData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip formatter={(value) => [value.toFixed(2) + ' 元', '金额']} />
                    <Bar dataKey="amount" name="金额">
                      {transactionAmountData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* 收回贷款确认对话框 */}
      <Dialog open={collectDialogOpen} onClose={() => setCollectDialogOpen(false)}>
        <DialogTitle>确认收回贷款</DialogTitle>
        <DialogContent>
          <Typography>
            您确定要收回贷款吗？
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            本金：{selectedTransaction?.amount} 元
          </Typography>
          <Typography variant="body2" color="text.secondary">
            利率：{selectedTransaction?.interestRate}%
          </Typography>
          <Typography variant="body2" color="text.secondary">
            到期总额：{selectedTransaction?.totalAmount?.toFixed(2)} 元
          </Typography>
          <Typography variant="body2" color="text.secondary">
            到期时间：{selectedTransaction?.dueDate ? new Date(selectedTransaction.dueDate).toLocaleString() : ''}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCollectDialogOpen(false)}>取消</Button>
          <Button
            onClick={handleConfirmCollect}
            variant="contained"
            color="primary"
          >
            确认收回
          </Button>
        </DialogActions>
      </Dialog>

      {/* 还款确认对话框 */}
      <Dialog open={repayDialogOpen} onClose={() => setRepayDialogOpen(false)}>
        <DialogTitle>确认还款</DialogTitle>
        <DialogContent>
          <Typography>
            您确定要还款吗？
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            还款金额：{selectedTransaction?.amount} 元
          </Typography>
          <Typography variant="body2" color="text.secondary">
            到期时间：{selectedTransaction?.dueDate ? new Date(selectedTransaction.dueDate).toLocaleString() : ''}
          </Typography>
          {!latestProof && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              请先在"信用证明"页面生成信用证明
            </Alert>
          )}
          <TextField
            fullWidth
            label="验证口令"
            value={verificationCode}
            onChange={(e) => setVerificationCode(e.target.value)}
            margin="normal"
            disabled={!latestProof}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRepayDialogOpen(false)}>取消</Button>
          <Button
            onClick={handleConfirmRepay}
            variant="contained"
            color="primary"
            disabled={!verificationCode || !latestProof}
          >
            确认还款
          </Button>
        </DialogActions>
      </Dialog>

      {/* 警告对话框 */}
      <Dialog open={warningDialogOpen} onClose={() => setWarningDialogOpen(false)}>
        <DialogTitle>提示</DialogTitle>
        <DialogContent>
          <Typography>
            {warningMessage}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setWarningDialogOpen(false)}>确定</Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};

export default Account; 
