# Docker 网络/bridge 问题排查

适用场景：
- 容器间无法互相访问（同一 docker-compose 或自定义网络）
- 容器无法访问外网或宿主机服务
- `docker network` 相关报错，或服务发现失败

常见原因：
- 容器未加入同一自定义网络（默认 bridge 不支持 DNS 服务发现）
- 宿主机 iptables 规则被清空或 FORWARD 链被 DROP
- docker-compose 服务名拼写错误导致无法通过 DNS 解析
- 端口未正确 expose/publish

步骤（最小可用）：

1) 查看所有 Docker 网络
```bash
docker network ls
```

2) 查看网络详情（哪些容器在该网络中）
```bash
docker network inspect <network-name>
```

3) 测试容器间连通性（ping / curl）
```bash
docker exec <container-name> ping -c3 <other-container-name>
docker exec <container-name> curl http://<other-container-name>:<port>
```

4) 查看容器的网络配置
```bash
docker inspect <container-name> | grep -A30 '"Networks"'
```

5) 手动将容器加入网络
```bash
docker network connect <network-name> <container-name>
```

6) 创建自定义网络并重建容器（推荐）
```bash
docker network create my-net
docker run -d --network my-net --name svc1 image1
docker run -d --network my-net --name svc2 image2
# 此时 svc1 可通过 svc2 域名访问 svc2
```

7) 检查宿主机 iptables FORWARD 链
```bash
sudo iptables -L FORWARD -n -v
# 若 FORWARD 链 policy 为 DROP，Docker 可能无法转发
sudo iptables -P FORWARD ACCEPT
```

8) 重置 Docker 网络（谨慎，会中断现有连接）
```bash
sudo systemctl restart docker
```

验证：
```bash
# 容器间能 ping 通
docker exec svc1 ping -c3 svc2
# 容器能访问外网
docker exec svc1 curl -s https://www.baidu.com -o /dev/null -w "%{http_code}"
```

注意事项：
- 默认 `bridge` 网络不支持容器 DNS 名解析；容器间通信务必使用自定义网络
- `docker-compose` 会自动创建同名自定义网络，同 compose 文件的服务可直接用服务名通信

关键词：
- docker network bridge
- container cannot connect
- docker network inspect
- FORWARD chain iptables docker
- docker-compose network
- container DNS resolution
