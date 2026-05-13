<?php

if (!defined("WHMCS")) {
    die("This file cannot be accessed directly");
}

function cloudpanel_MetaData()
{
    return [
        "DisplayName" => "CloudPanel",
        "APIVersion" => "1.1",
        "RequiresServer" => true,
    ];
}

function cloudpanel_ConfigOptions()
{
    return [
        "Node ID" => ["Type" => "text", "Size" => "64", "Description" => "CloudPanel node ID"],
        "Plan ID" => ["Type" => "text", "Size" => "64", "Description" => "CloudPanel plan ID"],
        "OS Template" => ["Type" => "text", "Size" => "64", "Description" => "CloudPanel OS template slug"],
        "IP Count" => ["Type" => "text", "Size" => "8", "Default" => "1"],
    ];
}

function cloudpanel_CreateAccount(array $params)
{
    return cloudpanel_call($params, "CreateAccount");
}

function cloudpanel_TerminateAccount(array $params)
{
    return cloudpanel_call($params, "TerminateAccount");
}

function cloudpanel_SuspendAccount(array $params)
{
    return cloudpanel_call($params, "SuspendAccount");
}

function cloudpanel_UnsuspendAccount(array $params)
{
    return cloudpanel_call($params, "UnsuspendAccount");
}

function cloudpanel_ChangePackage(array $params)
{
    return cloudpanel_call($params, "ChangePackage");
}

function cloudpanel_call(array $params, string $action)
{
    $serverUrl = rtrim($params["serverhostname"] ?: $params["serverip"], "/");
    if (!preg_match('/^https?:\/\//', $serverUrl)) {
        $serverUrl = "https://" . $serverUrl;
    }

    $payload = [
        "action" => $action,
        "serviceId" => (string) $params["serviceid"],
        "userEmail" => $params["clientsdetails"]["email"] ?? null,
        "userName" => trim(($params["clientsdetails"]["firstname"] ?? "") . " " . ($params["clientsdetails"]["lastname"] ?? "")),
        "nodeId" => $params["configoption1"] ?? null,
        "planId" => $params["configoption2"] ?? null,
        "osTemplate" => $params["configoption3"] ?? null,
        "ipCount" => isset($params["configoption4"]) ? (int) $params["configoption4"] : 1,
    ];

    $ch = curl_init($serverUrl . "/api/v1/whmcs");
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => [
            "Content-Type: application/json",
            "X-CloudPanel-WHMCS-Key: " . $params["serverpassword"],
        ],
        CURLOPT_POSTFIELDS => json_encode($payload),
        CURLOPT_TIMEOUT => 60,
    ]);

    $response = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);

    if ($response === false || $status >= 400) {
        return "CloudPanel API error: " . ($error ?: $response);
    }

    $decoded = json_decode($response, true);
    if (!is_array($decoded) || empty($decoded["ok"]) && $action !== "Status") {
        return "Unexpected CloudPanel response: " . $response;
    }

    return "success";
}
