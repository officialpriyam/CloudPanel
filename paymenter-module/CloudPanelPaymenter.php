<?php

/**
 * CloudPanel Paymenter integration helper.
 *
 * Configure:
 * - CLOUDPANEL_URL: https://panel.example.com
 * - CLOUDPANEL_PAYMENTER_KEY: same value as PAYMENTER_API_KEY in CloudPanel
 *
 * Paymenter installations vary by version/customization, so this file exposes a
 * small client class that product/module hooks can call from create, suspend,
 * unsuspend, terminate, upgrade, status, and credit-topup events.
 */
class CloudPanelPaymenter
{
    private string $baseUrl;
    private string $apiKey;

    public function __construct(?string $baseUrl = null, ?string $apiKey = null)
    {
        $this->baseUrl = rtrim($baseUrl ?: getenv("CLOUDPANEL_URL"), "/");
        $this->apiKey = $apiKey ?: getenv("CLOUDPANEL_PAYMENTER_KEY");
    }

    public function create(array $payload): array
    {
        return $this->call(array_merge($payload, ["action" => "create"]));
    }

    public function terminate(string $serviceId, ?string $vmId = null): array
    {
        return $this->call(["action" => "terminate", "serviceId" => $serviceId, "vmId" => $vmId]);
    }

    public function suspend(string $serviceId, ?string $vmId = null): array
    {
        return $this->call(["action" => "suspend", "serviceId" => $serviceId, "vmId" => $vmId]);
    }

    public function unsuspend(string $serviceId, ?string $vmId = null): array
    {
        return $this->call(["action" => "unsuspend", "serviceId" => $serviceId, "vmId" => $vmId]);
    }

    public function upgrade(string $serviceId, string $planId, ?string $vmId = null): array
    {
        return $this->call(["action" => "upgrade", "serviceId" => $serviceId, "planId" => $planId, "vmId" => $vmId]);
    }

    public function status(string $serviceId, ?string $vmId = null): array
    {
        return $this->call(["action" => "status", "serviceId" => $serviceId, "vmId" => $vmId]);
    }

    public function credit(string $serviceId, string $userEmail, int $amount, string $currency = "usd"): array
    {
        return $this->call([
            "action" => "credit",
            "serviceId" => $serviceId,
            "userEmail" => $userEmail,
            "amount" => $amount,
            "currency" => $currency,
        ]);
    }

    private function call(array $payload): array
    {
        if (!$this->baseUrl || !$this->apiKey) {
            throw new RuntimeException("CloudPanel Paymenter module is not configured.");
        }

        $ch = curl_init($this->baseUrl . "/api/v1/paymenter");
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => [
                "Content-Type: application/json",
                "X-CloudPanel-Paymenter-Key: " . $this->apiKey,
            ],
            CURLOPT_POSTFIELDS => json_encode($payload),
            CURLOPT_TIMEOUT => 60,
        ]);

        $response = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);

        if ($response === false || $status >= 400) {
            throw new RuntimeException("CloudPanel API error: " . ($error ?: $response));
        }

        $decoded = json_decode($response, true);
        if (!is_array($decoded)) {
            throw new RuntimeException("Invalid CloudPanel response: " . $response);
        }

        return $decoded;
    }
}
