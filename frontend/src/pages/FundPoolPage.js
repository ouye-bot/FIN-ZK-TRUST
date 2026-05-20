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
  Chip,
  Button,
  CircularProgress,
  Alert,
  LinearProgress,
  Tabs,
  Tab,
} from '@mui/material';
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
  AreaChart,
  Area,
} from 'recharts';
import { get } from '../utils/apiUtils';

const FundPoolPage = ({ user }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState(0);
  const [poolData, setPoolData] = useState({
    platformCapital: 0,
    userCapital: 0,
    loanedAmount: 0,
    totalPool: 0,
    availableAmount: 0,
    totalInvestors: 0,
    emergencyBorrow: 0,
    totalInterest: 0,
    status: 'normal',
    userPoolStatus: 'normal'
  });
  const [poolHistory, setPoolHistory] = useState([]);

  useEffect(() => {
    fetchPoolData();
    fetchPoolHistory();
    
    // 监听刷新事件
    const handleRefresh = () => {
      fetchPoolData();
      fetchPoolHistory();
    };
    
    window.addEventListener('refreshPoolData', handleRefresh);
    
    // 清理事件监听器
    return () => {
      window.removeEventListener('refreshPoolData', handleRefresh);
    };
  }, []);

  const fetchPoolData = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await get('/api/v1/pool');
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      if (data.success) {
        setPoolData(data.pool);
      } else {
        setError(data.message || '获取资金池数据失败');
      }
    } catch (err) {
      console.error('获取资金池数据失败:', err);
      setError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  // 获取资金池历史数据
  const fetchPoolHistory = async () => {
    try {
      const response = await get('/api/v1/pool/history');
      
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.history) {
          setPoolHistory(data.history);
        }
      }
    } catch (err) {
      console.error('获取资金池历史数据失败:', err);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'normal':
        return 'success';
      case 'warning':
        return 'warning';
      case 'critical':
        return 'error';
      default:
        return 'info';
    }
  };

  const getStatusLabel = (status) => {
    switch (status) {
      case 'normal':
        return '正常';
      case 'warning':
        return '警告';
      case 'critical':
        return '紧急';
      default:
        return '未知';
    }
  };

  // 资金池构成数据
  const poolCompositionData = [
    { name: '平台本金', value: poolData.platformCapital, color: '#00B4D8' },
    { name: '用户出资', value: poolData.userCapital, color: '#06D6A0' },
  ];

  // 资金使用情况数据
  const fundUsageData = [
    { name: '可用资金', value: poolData.availableAmount, color: '#06D6A0' },
    { name: '已借出', value: poolData.loanedAmount, color: '#7209B7' },
  ];

  // 资金池健康度
  const totalPool = poolData.totalPool || (poolData.platformCapital + poolData.userCapital);
  const utilizationRate = totalPool > 0 ? ((totalPool - poolData.availableAmount) / totalPool * 100) : 0;

  return (
    <Container maxWidth="lg" sx={{ mt: 4 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        资金池管理
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
        <Tab label="资金池概览" />
        <Tab label="数据分析" />
      </Tabs>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
          <CircularProgress />
        </Box>
      ) : (
        <>
          {activeTab === 0 && (
            <Grid container spacing={3}>
              {/* 资金池状态卡片 */}
              <Grid item xs={12} md={4}>
                <Card sx={{ height: '100%' }}>
                  <CardHeader
                    title="资金池状态"
                    subheader="整体健康度"
                  />
                  <CardContent>
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="body2" color="text.secondary" gutterBottom>
                        资金利用率
                      </Typography>
                      <LinearProgress
                        variant="determinate"
                        value={utilizationRate}
                        sx={{
                          height: 10,
                          borderRadius: 5,
                          backgroundColor: '#e0e0e0',
                          '& .MuiLinearProgress-bar': {
                            backgroundColor: utilizationRate > 80 ? '#F72585' : utilizationRate > 60 ? '#FFD60A' : '#06D6A0',
                          }
                        }}
                      />
                      <Typography variant="body2" sx={{ mt: 1 }}>
                        {utilizationRate.toFixed(2)}%
                      </Typography>
                    </Box>
                    <Chip
                      label={`状态: ${getStatusLabel(poolData.status)}`}
                      color={getStatusColor(poolData.status)}
                      size="small"
                      sx={{ mb: 2 }}
                    />
                    <Typography variant="body2" color="text.secondary">
                      出资者数量: {poolData.totalInvestors}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>

              {/* 原始资金池 */}
              <Grid item xs={12} md={4}>
                <Card sx={{ height: '100%' }}>
                  <CardHeader
                    title="平台本金"
                    subheader="系统初始资金"
                  />
                  <CardContent>
                    <Typography variant="h4" color="primary" sx={{ mb: 2 }}>
                      ¥{Number(poolData.platformCapital || 0).toFixed(2)}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      占总资金的 {totalPool > 0 ? (Number(poolData.platformCapital || 0) / totalPool * 100).toFixed(2) : 0}%
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>

              {/* 用户资金池 */}
              <Grid item xs={12} md={4}>
                <Card sx={{ height: '100%' }}>
                  <CardHeader
                    title="用户出资"
                    subheader="用户出资资金"
                  />
                  <CardContent>
                    <Typography variant="h4" color="success.main" sx={{ mb: 2 }}>
                      ¥{Number(poolData.userCapital || 0).toFixed(2)}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      占总资金的 {totalPool > 0 ? (Number(poolData.userCapital || 0) / totalPool * 100).toFixed(2) : 0}%
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>

              {/* 已借出金额 */}
              <Grid item xs={12} md={4}>
                <Card sx={{ height: '100%' }}>
                  <CardHeader
                    title="已借出金额"
                    subheader="当前在贷本金"
                  />
                  <CardContent>
                    <Typography variant="h4" color="secondary.main" sx={{ mb: 2 }}>
                      ¥{Number(poolData.loanedAmount || 0).toFixed(2)}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      占用率 {totalPool > 0 ? (Number(poolData.loanedAmount || 0) / totalPool * 100).toFixed(2) : 0}%
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>

              {/* 总览卡片 */}
              <Grid item xs={12}>
                <Card>
                  <CardHeader
                    title="资金池总览"
                    subheader="资金池整体情况"
                  />
                  <CardContent>
                    <Grid container spacing={3}>
                      <Grid item xs={12} sm={6} md={3}>
                        <Box sx={{ textAlign: 'center', p: 2 }}>
                          <Typography variant="h5" color="primary">
                            ¥{Number(totalPool || 0).toFixed(2)}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            总资金
                          </Typography>
                        </Box>
                      </Grid>
                      <Grid item xs={12} sm={6} md={3}>
                        <Box sx={{ textAlign: 'center', p: 2 }}>
                          <Typography variant="h5" color="success.main">
                            ¥{Number(poolData.availableAmount || 0).toFixed(2)}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            可用资金
                          </Typography>
                        </Box>
                      </Grid>
                      <Grid item xs={12} sm={6} md={3}>
                        <Box sx={{ textAlign: 'center', p: 2 }}>
                          <Typography variant="h5" color="warning.main">
                            ¥{Number(poolData.platformInterest || 0).toFixed(2)}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            平台利息
                          </Typography>
                        </Box>
                      </Grid>
                      <Grid item xs={12} sm={6} md={3}>
                        <Box sx={{ textAlign: 'center', p: 2 }}>
                          <Typography variant="h5" color="info.main">
                            ¥{Number(poolData.userInterest || 0).toFixed(2)}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            用户利息
                          </Typography>
                        </Box>
                      </Grid>
                    </Grid>

                    {/* 资金池健康指标 */}
                    {poolData.health && (
                      <Box sx={{ mt: 3, p: 2, backgroundColor: '#f5f5f5', borderRadius: 2 }}>
                        <Typography variant="subtitle2" gutterBottom>
                          池健康指标
                        </Typography>
                        <Grid container spacing={2}>
                          <Grid item xs={3}>
                            <Typography variant="body2" color="text.secondary">资金利用率</Typography>
                            <Typography variant="h6" color={poolData.health.utilizationRate > 80 ? 'error.main' : poolData.health.utilizationRate > 60 ? 'warning.main' : 'success.main'}>
                              {poolData.health.utilizationRate}%
                            </Typography>
                          </Grid>
                          <Grid item xs={3}>
                            <Typography variant="body2" color="text.secondary">用户出资占比</Typography>
                            <Typography variant="h6" color="primary">
                              {poolData.health.userRatio}%
                            </Typography>
                          </Grid>
                          <Grid item xs={3}>
                            <Typography variant="body2" color="text.secondary">可用资金占比</Typography>
                            <Typography variant="h6" color={poolData.health.availableRatio < 20 ? 'error.main' : 'success.main'}>
                              {poolData.health.availableRatio}%
                            </Typography>
                          </Grid>
                          <Grid item xs={3}>
                            <Typography variant="body2" color="text.secondary">逾期率</Typography>
                            <Typography variant="h6" color={poolData.health.overdueRate > 10 ? 'error.main' : poolData.health.overdueRate > 5 ? 'warning.main' : 'success.main'}>
                              {poolData.health.overdueRate}%
                            </Typography>
                          </Grid>
                        </Grid>
                      </Box>
                    )}

                    <Box sx={{ mt: 2, textAlign: 'center' }}>
                      <Button
                        variant="outlined"
                        color="primary"
                        onClick={fetchPoolData}
                      >
                        刷新数据
                      </Button>
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>
          )}

          {activeTab === 1 && (
            <Grid container spacing={3}>
              {/* 资金池构成饼图 */}
              <Grid item xs={12} md={6}>
                <Card>
                  <CardHeader
                    title="资金池构成"
                    subheader="原始资金与用户资金占比"
                  />
                  <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                      <PieChart>
                        <Pie
                          data={poolCompositionData}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={100}
                          paddingAngle={5}
                          dataKey="value"
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(1)}%`}
                        >
                          {poolCompositionData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value) => `¥${value.toFixed(2)}`} />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </Grid>

              {/* 资金使用情况 */}
              <Grid item xs={12} md={6}>
                <Card>
                  <CardHeader
                    title="资金使用情况"
                    subheader="各类资金分布"
                  />
                  <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={fundUsageData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" />
                        <YAxis />
                        <Tooltip formatter={(value) => `¥${value.toFixed(2)}`} />
                        <Bar dataKey="value" name="金额">
                          {fundUsageData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </Grid>

              {/* 资金池历史趋势 */}
              {poolHistory.length > 0 && (
                <Grid item xs={12}>
                  <Card>
                    <CardHeader
                      title="资金池历史趋势"
                      subheader="资金池变化情况"
                    />
                    <CardContent>
                      <ResponsiveContainer width="100%" height={300}>
                        <AreaChart data={poolHistory}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="date" />
                          <YAxis />
                          <Tooltip formatter={(value) => `¥${value.toFixed(2)}`} />
                          <Legend />
                          <Area
                            type="monotone"
                            dataKey="totalPool"
                            name="总资金"
                            stroke="#00B4D8"
                            fill="#00B4D8"
                            fillOpacity={0.3}
                          />
                          <Area
                            type="monotone"
                            dataKey="available"
                            name="可用资金"
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
            </Grid>
          )}
        </>
      )}
    </Container>
  );
};

export default FundPoolPage;
