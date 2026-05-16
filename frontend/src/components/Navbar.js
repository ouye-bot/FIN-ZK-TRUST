import React, { useState, useEffect } from 'react';
import { AppBar, Toolbar, Typography, Button, Box, IconButton, Drawer, List, ListItem, ListItemText, ListItemIcon, Divider, Avatar, Menu, MenuItem } from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import HomeIcon from '@mui/icons-material/Home';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import CreditCardIcon from '@mui/icons-material/CreditCard';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import PoolIcon from '@mui/icons-material/Pool';
import SecurityIcon from '@mui/icons-material/Security';
import LogoutIcon from '@mui/icons-material/Logout';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import PersonIcon from '@mui/icons-material/Person';
import SettingsIcon from '@mui/icons-material/Settings';
import { useNavigate, useLocation } from 'react-router-dom';

const Navbar = ({ user, onLogout, onToggleLogPanel }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [userMenuAnchor, setUserMenuAnchor] = useState(null);

  useEffect(() => {
    // user 变化时立即关闭菜单，防止 Portal 锚点被卸载导致 Node.removeChild 错误
    setUserMenuAnchor(null);
  }, [user]);

  const isActive = (path) => location.pathname === path;

  const navItems = [
    { text: '个人中心', icon: <HomeIcon />, path: '/profile' },
    { text: '借款', icon: <AccountBalanceWalletIcon />, path: '/borrow' },
    { text: '信用证明', icon: <CreditCardIcon />, path: '/credit-proof' },
    { text: '出资', icon: <TrendingUpIcon />, path: '/invest' },
    { text: '赎回', icon: <SwapHorizIcon />, path: '/redeem' },
    { text: '我的投资', icon: <PoolIcon />, path: '/my-invest' },
    { text: '资金池', icon: <PoolIcon />, path: '/fund-pool' },
  ];

  const handleNav = (path) => {
    navigate(path);
    setDrawerOpen(false);
    setUserMenuAnchor(null);
  };

  const handleLogout = () => {
    setUserMenuAnchor(null);
    if (onLogout) onLogout();
    navigate('/');
  };

  const handleUserMenuClick = (event) => {
    setUserMenuAnchor(event.currentTarget);
  };

  const handleUserMenuClose = () => {
    setUserMenuAnchor(null);
  };

  return (
    <>
      <AppBar position="static" sx={{
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
      }}>
        <Toolbar sx={{ minHeight: 70 }}>
          {/* 移动端菜单按钮 */}
          <IconButton
            edge="start"
            color="inherit"
            aria-label="menu"
            onClick={() => setDrawerOpen(true)}
            sx={{ mr: 2, display: { md: 'none' } }}
          >
            <MenuIcon />
          </IconButton>

          {/* 系统标题 */}
          <Typography
            variant="h5"
            component="div"
            sx={{
              flexGrow: 1,
              minWidth: 0,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              fontWeight: 700,
              letterSpacing: '-0.025em',
            }}
            onClick={() => navigate('/profile')}
          >
            <SecurityIcon sx={{ fontSize: 32, color: '#3b82f6', flexShrink: 0 }} />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>FinZk</span>
              <span style={{ color: '#3b82f6', whiteSpace: 'nowrap' }}>Trust</span>
            </Box>
          </Typography>

          {/* 桌面端导航按钮 */}
          <Box sx={{ 
            display: { xs: 'none', md: 'flex' }, 
            alignItems: 'center', 
            gap: 0.5,
            flexShrink: 0,
            mr: 2
          }}>
            {user && (
              <>
                {navItems.map((item) => (
                  <Button
                    key={item.text}
                    color="inherit"
                    onClick={() => handleNav(item.path)}
                    sx={{ 
                      fontWeight: 500, 
                      borderRadius: 2, 
                      px: 1.5,
                      py: 1,
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                      bgcolor: isActive(item.path) ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                      '&:hover': {
                        bgcolor: isActive(item.path) ? 'rgba(59, 130, 246, 0.3)' : 'rgba(255, 255, 255, 0.1)',
                      }
                    }}
                    startIcon={item.icon}
                  >
                    {item.text}
                  </Button>
                ))}
                
                {/* 密码日志按钮 */}
                <Button 
                  color="inherit" 
                  onClick={onToggleLogPanel} 
                  startIcon={<LockOpenIcon />} 
                  sx={{ 
                    fontWeight: 500, 
                    borderRadius: 2, 
                    px: 1.5,
                    py: 1,
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                    '&:hover': {
                      bgcolor: 'rgba(255, 255, 255, 0.1)',
                    }
                  }}
                >
                  密码日志
                </Button>
                
                {/* 用户头像按钮 */}
                <IconButton
                  onClick={handleUserMenuClick}
                  sx={{ 
                    ml: 1,
                    flexShrink: 0,
                    '&:hover': {
                      bgcolor: 'rgba(255, 255, 255, 0.1)',
                    }
                  }}
                >
                  <Avatar sx={{ 
                    background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                    width: 40,
                    height: 40,
                    fontWeight: 600,
                  }}>
                    {user.username?.charAt(0).toUpperCase()}
                  </Avatar>
                </IconButton>
              </>
            )}
          </Box>
        </Toolbar>
      </AppBar>

      {/* 用户下拉菜单 */}
      <Menu
        anchorEl={userMenuAnchor}
        open={Boolean(userMenuAnchor)}
        onClose={handleUserMenuClose}
        PaperProps={{
          sx: {
            mt: 1.5,
            minWidth: 200,
            borderRadius: 2,
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
          }
        }}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'right',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
      >
        <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {user?.username}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            信用分: {user?.creditScore || 0}
          </Typography>
        </Box>
        
        <MenuItem onClick={() => handleNav('/profile')} sx={{ py: 1.2 }}>
          <ListItemIcon sx={{ color: '#64748b' }}>
            <PersonIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>个人中心</ListItemText>
        </MenuItem>
        
        <MenuItem onClick={() => handleNav('/account')} sx={{ py: 1.2 }}>
          <ListItemIcon sx={{ color: '#64748b' }}>
            <SettingsIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>账户管理</ListItemText>
        </MenuItem>
        
        <MenuItem onClick={() => handleNav('/mfa/setup')} sx={{ py: 1.2 }}>
          <ListItemIcon sx={{ color: '#64748b' }}>
            <SecurityIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>MFA 设置</ListItemText>
        </MenuItem>
        
        <Divider />
        
        <MenuItem onClick={handleLogout} sx={{ py: 1.2, color: '#ef4444' }}>
          <ListItemIcon sx={{ color: '#ef4444' }}>
            <LogoutIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>退出登录</ListItemText>
        </MenuItem>
      </Menu>

      {/* 移动端侧边栏 */}
      <Drawer
        anchor="left"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        PaperProps={{ sx: { width: 280, borderRight: '1px solid #e2e8f0' } }}
      >
        <Box sx={{ p: 3, background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)', color: 'white' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
            <SecurityIcon sx={{ fontSize: 28, color: '#3b82f6' }} />
            <Typography variant="h6" sx={{ fontWeight: 700 }}>FinZkTrust</Typography>
          </Box>
          {user && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 2 }}>
              <Avatar sx={{ background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)', width: 44, height: 44, fontWeight: 600 }}>
                {user.username?.charAt(0).toUpperCase()}
              </Avatar>
              <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{user.username}</Typography>
                <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>信用分: {user.creditScore}</Typography>
              </Box>
            </Box>
          )}
        </Box>
        <Divider />
        <List sx={{ p: 1 }}>
          {navItems.map((item) => (
            <ListItem
              button
              key={item.text}
              onClick={() => handleNav(item.path)}
              selected={isActive(item.path)}
              sx={{
                mb: 0.5, borderRadius: 2, mx: 1,
                '&.Mui-selected': {
                  backgroundColor: 'rgba(59, 130, 246, 0.12)',
                  '&:hover': { backgroundColor: 'rgba(59, 130, 246, 0.18)' },
                  '& .MuiListItemIcon-root': { color: '#3b82f6' },
                  '& .MuiListItemText-primary': { color: '#0f172a', fontWeight: 600 }
                },
                '&:hover': { backgroundColor: 'rgba(15, 23, 42, 0.04)' }
              }}
            >
              <ListItemIcon sx={{ color: isActive(item.path) ? '#3b82f6' : '#64748b' }}>{item.icon}</ListItemIcon>
              <ListItemText primary={item.text} sx={{ '& .MuiListItemText-primary': { fontWeight: 500 } }} />
            </ListItem>
          ))}
        </List>
        <Divider />
        <List sx={{ p: 1 }}>
          <ListItem button onClick={onToggleLogPanel} sx={{ mb: 0.5, borderRadius: 2, mx: 1, '&:hover': { backgroundColor: 'rgba(15, 23, 42, 0.04)' } }}>
            <ListItemIcon sx={{ color: '#64748b' }}><LockOpenIcon /></ListItemIcon>
            <ListItemText primary="密码日志" sx={{ '& .MuiListItemText-primary': { fontWeight: 500 } }} />
          </ListItem>
          <ListItem button onClick={handleLogout} sx={{ mb: 0.5, borderRadius: 2, mx: 1, '&:hover': { backgroundColor: 'rgba(239, 68, 68, 0.08)' } }}>
            <ListItemIcon sx={{ color: '#ef4444' }}><LogoutIcon /></ListItemIcon>
            <ListItemText primary="退出登录" sx={{ '& .MuiListItemText-primary': { fontWeight: 500, color: '#ef4444' } }} />
          </ListItem>
        </List>
      </Drawer>
    </>
  );
};

export default Navbar;
