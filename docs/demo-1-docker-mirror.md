# Demo1：Docker 换源工作流（Linux/Systemd 版）

## 起手操作
1) 在终端输入：`sudo vim /etc/docker/daemon.json`
2) 模拟用户写入镜像源配置并保存退出

## 期望系统自动建议（零输入弹出）
按顺序给出步骤：
1) `sudo systemctl daemon-reload`
2) `sudo systemctl restart docker`
3) `docker info`（或 `docker system info`）用于验证

## 期望校验
- 若 restart 成功：Verifier 标记为 ✅ 并提示下一步验证
- 若失败（例如 docker 服务名不同/无 systemd）：给出替代分支建议

## 评审亮点
- 上下文触发：识别“daemon.json 已修改”
- 工作流闭环：reload → restart → verify
- 风险提示：重启服务会影响正在运行的容器
