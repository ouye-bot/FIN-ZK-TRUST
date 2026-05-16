import React, { useState, useEffect } from 'react';
import {
  Container,
  Typography,
  Paper,
  Box,
  Grid,
  Card,
  CardContent,
  CardHeader,
  Button,
  Alert,
  CircularProgress,
  Chip,
  Tabs,
  Tab,
  LinearProgress,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { get } from '../utils/apiUtils';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  LineChart,
  Line,
  AreaChart,
  Area,
} from 'recharts';

const MyInvestPage = ({ user }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState(0);
  const [investments, setInvestments] = useState([]);
  const [totalInvestment, setTotalInvestment] = useState(0);
  const [totalExpectedReturn, setTotalExpectedReturn] = useState(0);
  const [totalReturn, setTotalReturn] = useState(0);
  const [investmentHistory, setInvestmentHistory] = useState([]);

  useEffect(() => {
    fetchInvestments();
  }, [user]);

  // 监听数据更新事件
  useEffect(() => {
    const handleDataUpdated = () => {
      console.log('Data updated event received, refreshing investment data...');
      fetchInvestments();
    };

    // 监听出资、赎回等操作完成的事件
    window.addEventListener('refreshUserData', handleDataUpdated);
    window.addEventListener('refreshPoolData', handleDataUpdated);
    window.addEventListener('refreshRedeemData', handleDataUpdated);

    return () => {
      window.removeEventListener('refreshUserData', handleDataUpdated);
      window.removeEventListener('refreshPoolData', handleDataUpdated);
      window.removeEventListener('refreshRedeemData', handleDataUpdated);
    };
  }, []);

  const fetchInvestments = async () => {
    try {
      setLoading(true);
      const response = await get(`/api/v1/invest/${user.id}`);
      const data = await response.json();
      if (data.success) {
        // 增强前端防御：对每条投资记录的关键数值使用 Number() 包裹
        const investments = data.investments.map(inv => ({
          ...inv,
          amount: Number(inv.amount),
          expectedReturn: Number(inv.expectedReturn || inv.interest || 0),
          term: Number(inv.term || 0),
          actualReturn: Number(inv.actualReturn || 0),
        }));
        setInvestments(investments);
        
        // 计算总出资金额和预期收益
        const totalInvest = investments.reduce((sum, investment) => sum + investment.amount, 0);
        const totalExpReturn = investments.reduce((sum, investment) => sum + investment.expectedReturn, 0);
        const totalRet = investments.reduce((sum, investment) => sum + investment.actualReturn, 0);
        setTotalInvestment(totalInvest);
        setTotalExpectedReturn(totalExpReturn);
        setTotalReturn(totalRet);
        
        // 生成出资历史数据
        generateInvestmentHistory(investments);
      } else {
        setError(data.message || '获取出资数据失败');
      }
    } catch (err) {
      console.error('获取出资数据失败:', err);
      setError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  // 生成出资历史数据
  const generateInvestmentHistory = (investments) => {
    const sortedInvestments = [...investments].sort((a, b) => 
      new Date(a.timestamp) - new Date(b.timestamp)
    );

    let cumulativeInvestment = 0;
    let cumulativeReturn = 0;
    const history = [];

    sortedInvestments.forEach((inv, index) => {
      cumulativeInvestment += inv.amount;
      cumulativeReturn += inv.expectedReturn;
      
      history.push({
        index: index + 1,
        date: new Date(inv.timestamp).toLocaleDateString(),
        amount: inv.amount,
        cumulativeInvestment: cumulativeInvestment,
        expectedReturn: inv.expectedReturn,
        cumulativeExpectedReturn: cumulativeReturn,
        term: inv.term,
      });
    });

    setInvestmentHistory(history);
  };

  const calculateAnnualRate = (amount, expectedReturn, term) => {
    if (amount === 0 || !term || term <= 0) return 0;
    const dailyRate = expectedReturn / amount / term;
    return dailyRate * 365 * 100;
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'active':
        return 'primary';
      case 'completed':
        return 'success';
      case 'pending':
        return 'warning';
      default:
        return 'info';
    }
  };

  const getStatusLabel = (status) => {
    switch (status) {
      case 'active':
        return '进行中';
      case 'completed':
        return '已完成';
      case 'pending':
        return '待处理';
      default:
        return '未知';
    }
  };

  // 出资状态分布数据
  const statusDistribution = [
    { 
      name: '进行中', 
      value: investments.filter(i => i.status === 'active').length,
      amount: investments.filter(i => i.status === 'active').reduce((sum, i) => sum + i.amount, 0),
      color: '#00B4D8' 
    },
    { 
      name: '已完成', 
      value: investments.filter(i => i.status === 'completed').length,
      amount: investments.filter(i => i.status === 'completed').reduce((sum, i) => sum + i.amount, 0),
      color: '#06D6A0' 
    },
    { 
      name: '待处理', 
      value: investments.filter(i => i.status === 'pending').length,
      amount: investments.filter(i => i.status === 'pending').reduce((sum, i) => sum + i.amount, 0),
      color: '#FFD60A' 
    },
  ];

  // 出资期限分布
  const termDistribution = [
    { name: '短期(≤30天)', count: investments.filter(i => (Number(i.term) || 0) <= 30 && (Number(i.term) || 0) > 0).length, color: '#00B4D8' },
    { name: '中期(31-90天)', count: investments.filter(i => (Number(i.term) || 0) > 30 && (Number(i.term) || 0) <= 90).length, color: '#7209B7' },
    { name: '长期(>90天)', count: investments.filter(i => (Number(i.term) || 0) > 90).length, color: '#06D6A0' },
  ];

  // 综合年化收益率
  const overallAnnualRate = totalInvestment > 0 ? 
    (totalExpectedReturn / totalInvestment / 365 * 365 * 100) : 0;

  // 收益完成度
  const returnCompletionRate = totalExpectedReturn > 0 ? 
    (totalReturn / totalExpectedReturn * 100) : 0;

  return (
    <Container maxWidth="lg" sx={{ mt: 4 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        我的出资
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Tabs
        value={activeTab}
        onChange={(e, newValue) => setActiveTab(newValue)}
        centered
        sx={{ mb: 3 }}
      >
        <Tab label="出资概览" />
        <Tab label="出资明细" />
        <Tab label="收益分析" />
      </Tabs>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
          <CircularProgress />
        </Box>
      ) : (
        <>
          {activeTab === 0 && (
            <Grid container spacing={3}>
              {/* 出资总览卡片 */}
              <Grid item xs={12} md={3}>
                <Card sx={{ height: '100%' }}>
                  <CardHeader title="总出资金额" />
                  <CardContent>
                    <Typography variant="h4" color="primary" sx={{ mb: 2 }}>
                      ¥{totalInvestment.toFixed(2)}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      出资笔数: {investments.length}笔
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>

              <Grid item xs={12} md={3}>
                <Card sx={{ height: '100%' }}>
                  <CardHeader title="预期总收益" />
                  <CardContent>
                    <Typography variant="h4" color="success.main" sx={{ mb: 2 }}>
                      ¥{totalExpectedReturn.toFixed(2)}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      综合年化: {overallAnnualRate.toFixed(2)}%
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>

              <Grid item xs={12} md={3}>
                <Card sx={{ height: '100%' }}>
                  <CardHeader title="实际总收益" />
                  <CardContent>
                    <Typography variant="h4" color={totalReturn >= totalExpectedReturn ? "success.main" : "warning.main"} sx={{ mb: 2 }}>
                      ¥{totalReturn.toFixed(2)}
                    </Typography>
                    <Box sx={{ mb: 1 }}>
                      <Typography variant="body2" color="text.secondary" gutterBottom>
                        收益完成度
                      </Typography>
                      <LinearProgress
                        variant="determinate"
                        value={Math.min(returnCompletionRate, 100)}
                        sx={{
                          height: 8,
                          borderRadius: 4,
                          backgroundColor: '#e0e0e0',
                        }}
                      />
                    </Box>
                    <Typography variant="body2" color="text.secondary">
                      {returnCompletionRate.toFixed(1)}%
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>

              <Grid item xs={12} md={3}>
                <Card sx={{ height: '100%' }}>
                  <CardHeader title="操作" />
                  <CardContent>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <Button
                        variant="contained"
                        color="primary"
                        fullWidth
                        onClick={() => navigate('/invest')}
                      >
                        继续出资
                      </Button>
                      <Button
                        variant="outlined"
                        color="primary"
                        fullWidth
                        onClick={() => navigate('/redeem')}
                      >
                        赎回资金
                      </Button>
                    </Box>
                  </CardContent>
                </Card>
              </Grid>

              {/* 出资状态分布 */}
              <Grid item xs={12} md={6}>
                <Card>
                  <CardHeader title="出资状态分布" />
                  <CardContent>
                    <ResponsiveContainer width="100%" height={250}>
                      <PieChart>
                        <Pie
                          data={statusDistribution}
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={80}
                          paddingAngle={5}
                          dataKey="value"
                          label={({ name, value }) => `${name}: ${value}笔`}
                        >
                          {statusDistribution.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value, name, props) => [`${value}笔`, props.payload.name]} />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </Grid>

              {/* 出资期限分布 */}
              <Grid item xs={12} md={6}>
                <Card>
                  <CardHeader title="出资期限分布" />
                  <CardContent>
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart data={termDistribution}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" />
                        <YAxis />
                        <Tooltip formatter={(value) => [`${value}笔`, '数量']} />
                        <Bar dataKey="count" name="出资笔数">
                          {termDistribution.map((entry, index) => (
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

          {activeTab === 1 && (
            <Grid container spacing={3}>
              {/* 出资明细列表 */}
              <Grid item xs={12}>
                <Card>
                  <CardHeader title="出资明细" />
                  <CardContent>
                    {investments.length === 0 ? (
                      <Typography variant="body2" color="text.secondary" align="center" sx={{ py: 4 }}>
                        暂无出资记录
                      </Typography>
                    ) : (
                      <Box sx={{ mt: 2 }}>
                        {investments.map((investment, index) => (
                          <Paper key={index} sx={{ p: 2, mb: 2, '&:hover': { boxShadow: 2 } }}>
                            <Grid container spacing={2} alignItems="center">
                              <Grid item xs={12} sm={3}>
                                <Typography variant="subtitle1" fontWeight="bold">
                                  ¥{investment.amount.toFixed(2)}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  出资金额
                                </Typography>
                              </Grid>
                              <Grid item xs={12} sm={3}>
                                <Typography variant="body2">
                                  {new Date(investment.timestamp).toLocaleDateString()}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  出资日期
                                </Typography>
                              </Grid>
                              <Grid item xs={12} sm={2}>
                                <Typography variant="body2">
                                  {investment.term > 0 ? investment.term : '未知'}天
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  出资期限
                                </Typography>
                              </Grid>
                              <Grid item xs={12} sm={2}>
                                <Chip
                                  label={getStatusLabel(investment.status)}
                                  color={getStatusColor(investment.status)}
                                  size="small"
                                />
                              </Grid>
                              <Grid item xs={12} sm={2}>
                                <Typography variant="body2" color="success.main">
                                  +¥{investment.expectedReturn.toFixed(2)}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  预期收益
                                </Typography>
                              </Grid>
                            </Grid>
                            <Box sx={{ mt: 1, pt: 1, borderTop: 1, borderColor: 'divider' }}>
                              <Typography variant="caption" color="text.secondary">
                                年化收益率: {calculateAnnualRate(investment.amount, investment.expectedReturn, investment.term).toFixed(2)}% | 
                                到期日期: {investment.maturityDate ? new Date(investment.maturityDate).toLocaleDateString() : '未知'}
                              </Typography>
                            </Box>
                          </Paper>
                        ))}
                      </Box>
                    )}
                  </CardContent>
                </Card>
              </Grid>
            </Grid>
          )}

          {activeTab === 2 && (
            <Grid container spacing={3}>
              {/* 出资收益趋势 */}
              {investmentHistory.length > 0 && (
                <Grid item xs={12}>
                  <Card>
                    <CardHeader title="出资收益趋势" />
                    <CardContent>
                      <ResponsiveContainer width="100%" height={300}>
                        <AreaChart data={investmentHistory}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="date" />
                          <YAxis />
                          <Tooltip formatter={(value) => `¥${value.toFixed(2)}`} />
                          <Legend />
                          <Area
                            type="monotone"
                            dataKey="cumulativeInvestment"
                            name="累计出资"
                            stroke="#00B4D8"
                            fill="#00B4D8"
                            fillOpacity={0.3}
                          />
                          <Area
                            type="monotone"
                            dataKey="cumulativeExpectedReturn"
                            name="累计预期收益"
                            stroke="#06D6A0"
                            fill="#06D6A0"
                            fillOpacity={0.3}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                </Grid>
              )}

              {/* 各笔出资收益对比 */}
              <Grid item xs={12} md={6}>
                <Card>
                  <CardHeader title="各笔出资收益对比" />
                  <CardContent>
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart data={investments.slice(0, 10)}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="id" tickFormatter={() => ''} />
                        <YAxis />
                        <Tooltip 
                          formatter={(value, name, props) => [
                            `¥${value.toFixed(2)}`, 
                            name === 'amount' ? '出资金额' : '预期收益'
                          ]}
                          labelFormatter={(label, payload) => {
                            if (payload && payload[0]) {
                              return `出资 #${payload[0].payload.id}`;
                            }
                            return '';
                          }}
                        />
                        <Legend />
                        <Bar dataKey="amount" name="出资金额" fill="#00B4D8" />
                        <Bar dataKey="expectedReturn" name="预期收益" fill="#06D6A0" />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </Grid>

              {/* 收益统计 */}
              <Grid item xs={12} md={6}>
                <Card>
                  <CardHeader title="收益统计" />
                  <CardContent>
                    <Box sx={{ mb: 3 }}>
                      <Typography variant="subtitle1" gutterBottom>
                        预计月收益
                      </Typography>
                      <Typography variant="h5" color="primary">
                        ¥{(totalExpectedReturn / 12).toFixed(2)}
                      </Typography>
                    </Box>
                    <Box sx={{ mb: 3 }}>
                      <Typography variant="subtitle1" gutterBottom>
                        预计年收益
                      </Typography>
                      <Typography variant="h5" color="primary">
                        ¥{totalExpectedReturn.toFixed(2)}
                      </Typography>
                    </Box>
                    <Box sx={{ mb: 3 }}>
                      <Typography variant="subtitle1" gutterBottom>
                        平均单笔出资
                      </Typography>
                      <Typography variant="h5" color="primary">
                        ¥{investments.length > 0 ? (totalInvestment / investments.length).toFixed(2) : '0.00'}
                      </Typography>
                    </Box>
                    <Box>
                      <Typography variant="subtitle1" gutterBottom>
                        平均出资期限
                      </Typography>
                      <Typography variant="h5" color="primary">
                        {investments.length > 0 ? (investments.reduce((sum, i) => sum + (Number(i.term) || 0), 0) / investments.length).toFixed(0) : 0} 天
                      </Typography>
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>
          )}
        </>
      )}
    </Container>
  );
};

export default MyInvestPage;
